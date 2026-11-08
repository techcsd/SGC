# Plan: traslados entre almacenes con Odoo como sistema de registro del movimiento

> **Superado por [`PLAN-INTEGRACION-ODOO-SGC.md`](./PLAN-INTEGRACION-ODOO-SGC.md)** (8-nov-2026), que decide los puntos abiertos de este documento. Se conserva como registro del análisis y de las mediciones.

Estado: PROPUESTA para aprobación (8-nov-2026). Nada de esto está aplicado. El código `traslados.*` del gateway existe sin commitear y solo en MOCK.

## 1. Análisis

### 1.1 Hechos verificados
1. **Odoo ya es donde se mueve el stock.** Consulta de solo lectura (perfil limitado): 146 transferencias internas (139 hechas, 6 canceladas, 1 borrador), 124 de las 136 creadas desde agosto por una sola persona. Mediana de creación a hecho: 0,3 min. Todas interna→interna, sin ubicación de tránsito. Los 24 almacenes tienen exactamente un tipo "Traslados internos" activo. 2 backorders en 146.
2. **SGC lo modela en dos etapas con evidencia.** Salida `despachado` → recepción `entregado` / `entregado_incompleto` (también `anulado`, `rechazada`). La recepción exige foto o nota, firma del receptor y cantidad recibida por línea (`confirmar_recepcion_salida`, `_aplicar_recepcion_salida`), y crea la entrada en la bodega de la obra.
3. **RBAC de SGC (a reutilizar):** despachar = admin / módulo `inventario` / `puede_ver_inventario_bodega`; recibir = además empleado asignado al proyecto, responsable, capataz o chofer de esa salida.
4. **SGC tiene su propio libro de stock:** `sgc.stock_por_bodega` es una TABLA con saldo corriente actualizado por RPC (upsert por delta), no una vista. 55 archivos SQL/TS la referencian; 16 migraciones insertan en `salidas_inventario`; en el front la consumen dashboard, bodegas, stock y conteos.
5. **Infraestructura reutilizable ya existente:** gateway `odoo-api` (capa anticorrupción), outbox transaccional CY6 con worker `odoo-sync` y lease (hoy solo para artículo, categoría, unidad y proveedor; salidas/entradas quedaron diferidas "con el mismo patrón"), política de publicación apagada por defecto, vínculos CY4, columnas `odoo_*` en bodegas, artículos, proveedores, OC, y el patrón de variantes paralelas `*-odoo` en Compras.
6. **Bloqueos de datos (corte 16-oct):** homologación pendiente (17 candidatos por nombre, piloto propuesto de 5 artículos), 27 bodegas contra 24 almacenes y 154 ubicaciones sin coincidencia por nombre, Monterezzo inactivo con 25 saldos positivos, 91 salidas incompletas, conversiones de unidad sin validar.
7. **D-08:** no hay sandbox de Odoo; solo existe una escritura real autorizada puntualmente (27-oct).

### 1.1b Medición en prod de SGC (8-nov-2026, solo SELECT, sin filas de prueba)
- Salidas: 258 en total (227 `uso_proyecto`, 17 `traslado_almacen`, 14 `devolucion`). Por mes: ago 50, sep 80, oct 111, nov (hasta el 7) 17.
- `traslado_almacen`: 17 en total (3 entregados, 4 incompletos, 6 despachados sin cerrar, 3 rechazados, 1 anulado), unos 4-7 al mes. Es una fracción pequeña del movimiento.
- `uso_proyecto`: 155 de 227 están `entregado_incompleto` (68%) y 40 `anulado`; solo 15 `entregado`. Odoo, en cambio, tiene 2 backorders en 146 traslados.
- Entradas: 160 `recepcion_obra`, 11 `compra`, 4 `traslado_almacen`, 1 `devolucion_obra`.
- **Homologación en prod: 0 de 29 bodegas, 0 de 295 artículos y 0 filas en `odoo_instancias`.** Hoy `traslados.crear` rechazaría todo traslado.
- Los traslados internos de Odoo desde agosto (131 hechos) se parecen más a las salidas a obra de SGC que a `traslado_almacen`. Puede haber doble captura, sin confirmar.

### 1.1c Respuestas verificadas el 8-nov-2026 (solo lectura)
- **Los "incompletos" son en su mayoría un artefacto, no faltantes reales.** De 160 salidas `entregado_incompleto`, las 160 se confirmaron por `conduce_confirmar_receptor` ("Confirmado por el receptor en su dispositivo", BD2). De sus 458 líneas, **442 tienen `cantidad_recibida` NULL** y solo 4 tienen un faltante real (3 en 0 y 1 parcial, una con la nota "No llegaron ties"). Esa función marca incompleto cuando una línea es NULL o menor, y no rellena el NULL con lo enviado como sí hace `_aplicar_recepcion_salida` (CJ6). La app que llama no envía cantidades, o llama sin `p_items` (la app móvil es otro repositorio y no la revisé). Cada traslado a Odoo debe tratar NULL como "recibido completo" o corregir esa función antes de publicar.
- **No hay evidencia de doble captura.** Cruzando 131 traslados internos hechos en Odoo desde agosto con 203 salidas no anuladas de SGC (fecha ±2 días, líneas y cantidades), solo 2 casan. Los artículos distintos son 101 en Odoo y 143 en SGC, y solo 10 coinciden por nombre; en Odoo apenas 1 de 373 líneas tiene `default_code`. Los dos sistemas mueven mayormente productos distintos. El método es estricto (sin homologación solo sirve el nombre), así que esto descarta una duplicación masiva pero no una puntual.
- **Odoo es 17.0+e (Enterprise).** Existen `stock.move.quantity` (no `quantity_done`), `move_ids_without_package`, `note`, `origin` y `backorder_id`. Existe el asistente `stock.backorder.confirmation`, pero **no existe `stock.immediate.transfer`**. El código del agente asume ese asistente en `button_validate` y hay que cambiarlo (en 17 se fija `quantity` en los movimientos y luego se valida).
- **Ambos perfiles de Odoo (`ODOO_` y `ODOO_LIMITED_`) tienen permiso de crear y escribir en `stock.picking`, `stock.move` y `stock.quant`.** El perfil "limitado" solo lo es por nuestra lista de permitidos en `odoo-client.ts`, no por Odoo. La lista de bases (`db.list`) está deshabilitada, así que no se puede confirmar si hay un sandbox.

### 1.1d Prueba de escritura mínima en Odoo real (8-nov-2026, autorizada por el dueño)
- Con el código real de `_shared/odoo-traslados.ts` y la cuenta del gateway (Eduardo Ng), se creó, confirmó y canceló UN traslado de prueba `WH/INT/00119` (picking 871, `WH/Almacén principal` → `TA/Existencias`) con el producto de prueba 1439, que no tiene stock. No se validó.
- Resultado verificado de forma independiente: estado `cancel`, movimiento `cancel`, 0 líneas de movimiento, 0 existencias del producto, 0 pickings `SGC-TRAS-` abiertos. La idempotencia por `origin` y la cancelación repetida funcionaron.
- Hallazgo: el chatter muestra el HTML escapado (se ve `<p>…<b>…</b></p>` como texto). Hay que enviar texto plano en `message_post`.
- Autor del chatter (solo lectura, 8-nov-2026): en 2.529 mensajes de pickings el autor siempre coincide con quien los creó (0 con autor distinto); hoy nadie publica "a nombre de" otro. Odoo tiene 10 usuarios internos (7 activos). De 54 usuarios SGC activos, 6 son usuarios internos de Odoo y 16 tienen un contacto con el mismo correo. `message_post` acepta `author_id`, así que se puede mostrar a la persona real como autora, pero `create_uid` seguiría siendo la cuenta técnica. Decisión del dueño (8-nov-2026): `author_id` + marca "vía SGC". Implementado en `_shared/odoo-traslados.ts` (`resolverAutorOdoo`, texto plano, `email_from` obligatorio cuando el contacto no tiene correo); la búsqueda del autor se verificó contra Odoo real en solo lectura (7 de 7 usuarios internos resueltos, correo ajeno → null). Falta el visto bueno de Contabilidad/Odoo y probar la escritura con el nuevo código.
- Efectos permanentes: el picking cancelado sigue existiendo en Odoo y consumió el número `WH/INT/00119`.
- Sin probar aún: `traslados.validar` (mueve stock y depende de un asistente que no existe en Odoo 17).

### 1.2 No verificado (hay que cerrarlo en la Fase 0)
- La validación contra Odoo real (`traslados.validar`): requiere sandbox o autorización específica (D-08).
- Qué envía exactamente la app móvil al confirmar la recepción (está fuera de este repo).
- Versión exacta de Odoo y nombres de campo (el código asume Odoo 17, probado solo con un Odoo falso).
- Que el estado de homologación de octubre siga igual.

### 1.3 Conclusión del análisis
- Con la evidencia de la recepción, el chofer, el conduce y el permiso por obra, **SGC debe conservar el documento de negocio**. Odoo no tiene dónde guardarlo.
- **Odoo debe ser el sistema de registro del movimiento de stock** (picking, líneas, cantidades hechas, estado).
- El riesgo central es **el doble libro de stock**: si el picking se crea solo en Odoo, `stock_por_bodega` no se entera.
- Cambiar las llaves primarias de ~10 tablas a ids de Odoo tiene muy poco beneficio y mucho riesgo. Se recomienda **conservar el uuid local y volver canónico el id de Odoo** como llave externa única.

## 2. Principios (estándar de la industria)
| Principio | Cómo se aplica aquí |
|---|---|
| Un solo escritor por dato | Tabla de propiedad abajo: cada dato tiene un dueño |
| Strangler fig / ejecución en paralelo | Variante `traslados-odoo` junto a Salidas; lo actual no se toca |
| Capa anticorrupción | Todo contacto con Odoo pasa por `odoo-api`; el navegador nunca manda ids de Odoo |
| Outbox transaccional + idempotencia | Evento en la misma transacción que la salida; clave `SGC-TRAS-<uuid>` en `origin` |
| Expand / contract | Migraciones aditivas; el retiro de lo viejo es la última fase |
| Despliegue gradual con flags | Por bodega y por usuario, con rollback inmediato |
| Conciliación continua | Job diario que compara SGC contra Odoo y alerta |
| Nunca escribir en prod sin sandbox | Prerrequisito de la Fase 2 (D-08) |

### Propiedad de datos
| Dato | Dueño |
|---|---|
| Picking, líneas, cantidad hecha, estado, stock por ubicación | Odoo |
| Auditoría de quién lo hizo | Chatter de Odoo (usuario real de SGC) |
| Firma, foto, notas y cantidad recibida | SGC |
| Obra, chofer, vehículo, conduce, ruta | SGC |
| Permisos y RBAC | SGC |
| Saldo de stock (fase 1-3) | SGC (espejo en Odoo); (fase 4) Odoo |

## 3. Arquitectura objetivo
1. **Despachar:** un RPC de SGC, en una transacción, crea la salida y su detalle con `odoo_sync_estado = 'pendiente'` y registra el evento del outbox.
2. **Publicar:** `odoo-sync` reclama el evento y llama a `traslados.crear` y `traslados.validar` del gateway (idempotente por `origin`). Guarda `odoo_picking_id`, deja el chatter y marca `sincronizado`. Si hay timeout, el estado queda `incierto` y se lee de Odoo por `origin`. El usuario ve "Reintentar", igual que en OC.
3. **Recibir:** el flujo actual de SGC (foto, firma, cantidades). No exige módulo de Odoo. Si hay faltante, se abre una tarea de ajuste y no se corrige solo.
4. **Conciliar:** job diario que compara salidas con `odoo_picking_id` contra el estado y las cantidades del picking.
5. **Esquema nuevo (aditivo):** en `salidas_inventario`, `odoo_instancia_id`, `odoo_picking_id` (único por instancia), `odoo_sync_estado`, `odoo_sync_error`. Esto reutiliza el vínculo CY4 y no crea una tabla de comandos aparte.

## 4. Fases
**Fase 0. Decisiones y prerrequisitos (sin código de producción).**
- Sandbox de Odoo (duplicar la base) para destrabar D-08.
- Confirmar con Contabilidad y Almacén el alcance: motivo `traslado_almacen` y envíos a bodega de obra.
- Medir el uso real en prod con un SELECT de solo lectura.
- Acordar el piloto: almacén principal → TA, 5 artículos, los dos usuarios que hoy operan en Odoo.
- Decidir la política de faltantes (¿se corrige en Odoo con ajuste, devolución o merma?).
- Salida: documento de decisiones firmado.

**Fase 1. Fundaciones (solo dev).**
- Rama nueva `feature/traslados-odoo` desde `dev` y commit del código actual tras revisión.
- Corregir: lectura filtrada por bodega, las pantallas de recepción sin pasar por la puerta `inventario`.
- Migración aditiva en `sql/` con su registro en el ledger y en `scripts/`.
- Homologar las 2 bodegas y los 5 artículos piloto.
- Salida: tests verdes, `verify-regresiones` y `release-check --env dev`.

**Fase 2. Ejecución en sombra contra sandbox.**
- Escritura real al sandbox, con pruebas de contrato (campos, wizards, backorder).
- Conciliación en seco y métricas (latencia, inciertos, reintentos).
- Salida: 2 semanas con 0 discrepancias.

**Fase 3. Canary en prod.**
- Flag por bodega y por usuario, solo el piloto.
- Alertas de conciliación y runbook de rollback (apagar la política de publicación).
- Salida: 2 semanas sin diferencias ni estados inciertos abiertos.

**Fase 4. Expansión.**
- Más bodegas, backorders y devoluciones, e integración con conduce y transporte.

**Fase 5. Cambio de fuente del stock (contract).**
- La lectura de saldo pasa a Odoo por ámbito y `stock_por_bodega` se retira por etapas.

## 5. Calidad y reglas del repo
Dev antes de prod (BU1), SQL en `sql/` y ledger (CD10), `docs/DATOS-Y-TERCEROS.md` por el nombre y correo en el chatter (CI13), notas de versión estructuradas (Y1), datos visibles en pantalla (AT11), errores traducidos por rol (BS2), textos con `t()` (BS4), SVG en vez de emojis (AW12) y gate `release-check` antes del PR a `main` (CP5).

## 6. Riesgos
| Riesgo | Mitigación |
|---|---|
| Doble captura o doble libro de stock | Un solo escritor, flag por bodega, conciliación diaria |
| Escribir en el Odoo real sin sandbox | Fase 2 en sandbox; prod solo con autorización explícita por fase |
| Homologación incompleta | Piloto de 5 artículos y bodegas; rechazo claro si no está homologada |
| Estado incierto tras timeout | Idempotencia por `origin` y lectura previa |
| Faltante en la recepción | Tarea de ajuste con aprobación; nunca automático |
| Odoo 17 contra 18/19 | Pruebas de contrato en el sandbox |

## 7. Decisiones pendientes del dueño
1. ¿Hay sandbox de Odoo?
2. ¿Odoo es el dueño del stock desde la Fase 4, o SGC sigue como libro?
3. ¿Qué se hace con un faltante en la recepción?
4. Alcance del piloto (bodegas, artículos, usuarios).
5. Qué rol valida o cancela traslados.
