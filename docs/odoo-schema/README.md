# Esquema aditivo SGC ↔ Odoo — paquete para el desarrollador

Fecha: 16/10/2026. Destino confirmado: **SGC / Supabase PostgreSQL**. Este paquete no modifica la base interna de Odoo.

## Qué se entrega

- **Fase 1 recomendada — campos:** `sql/20261016112524_odoo_identity_fields.sql`.
- Ampliación posterior para integración continua: `sql/20261016112525_odoo_sync_foundation.sql`.
- `01_verify_identity.sql`: verificación específica de la fase 1.
- `00_preflight.sql`: inspección de solo lectura antes de aplicar.
- `02_verify.sql`: verificación de objetos, permisos y correspondencias.
- `03_validate_constraints.sql`: validación posterior de las restricciones nuevas.
- Pruebas reproducibles: `qa/odoo-schema/`.

**Fase 1:** 61 columnas opcionales en 11 tablas existentes, 2 tablas de contexto (`odoo_instancias`, `odoo_companias`) y 2 funciones de protección. Basta para registrar los IDs homologados sin instalar colas ni vínculos de documentos. Las dos tablas identifican la base/compañía a la que pertenece cada ID nativo; los IDs de Odoo pueden repetirse entre bases.

**Ampliación opcional:** mantiene esos campos y añade 9 tablas y 5 funciones; el total del esquema completo es de 11 tablas nuevas y 7 funciones nuevas. Cero instancias/eventos se crean automáticamente. Las conexiones y ambas direcciones nacen deshabilitadas.

Las secciones 1 y 2 describen la fase mínima de campos; la sección 3 incluye también las tablas de la ampliación y la sección 4 corresponde a esa ampliación.

Se preparan identidades y persistencia para sincronización continua. **No se instala un worker, webhook, cron ni captura automática de cambios de negocio.** El desarrollador deberá conectar cada RPC/operación a la cola en la misma transacción; esta migración por sí sola no sincroniza registros.

## 1. Compatibilidad con la aplicación existente

- No se eliminan ni renombran tablas/columnas, no se cambian tipos actuales ni PK.
- Las 61 columnas nuevas son nullable, sin default y sin backfill. Los INSERT/UPDATE que omiten esos campos mantienen su contrato.
- `odoo_ref` no se toca, no se convierte a entero y queda fuera del trigger de protección.
- No se añade FK a `articulos.unidad`: hoy admite texto y hay valores que no corresponden al catálogo.
- No se reescribe stock ni se importa historia/apertura. No se modifica ningún RPC de negocio, RLS o grant anterior.
- Las FKs nuevas desde vínculos hacia documentos/líneas/unidades SGC usan `ON DELETE SET NULL ON UPDATE SET NULL`, conservando una copia del identificador. No impiden un borrado/cambio de PK previamente permitido.
- Se añade un trigger por tabla extendida que protege **solo los campos nuevos**. Un cliente `authenticated` conserva sus permisos anteriores sobre el resto de campos; la escritura técnica corresponde a `service_role`, `postgres` o `supabase_admin`. Los IDs no son secretos: pueden leerse donde el maestro ya permite lectura.
- Los administradores/RPC `SECURITY DEFINER` ejecutan con los privilegios de su propietario. Toda rutina nueva que acepte payload del cliente debe seguir excluyendo campos de identidad ERP no autorizados.
- Las restricciones nuevas sobre tablas antiguas se crean `NOT VALID`: no escanean inicialmente los datos históricos, pero sí controlan escrituras nuevas. El script 03 las valida después.
- Los índices/ALTER adquieren bloqueos breves; `lock_timeout=3s` y una transacción completa hacen que una contención aborte sin instalación parcial. Aditivo no significa ausencia absoluta de bloqueos.

Antes de aplicar, revisar el resultado del preflight: un RPC con retorno fijo que dependa de `SELECT *`, un INSERT sin lista de columnas o un consumidor externo que dependa del número exacto de columnas necesita una comprobación específica. Se buscaron esos patrones en SQL versionado sin detectar el patrón directo de RETURN QUERY sobre las tablas extendidas, pero no se certifican aquí todos los RPC desplegados ni todos los clientes externos.

## 2. Columnas nuevas

Todas las tablas de la matriz reciben estos campos comunes:

| Campo | Tipo | Significado |
| --- | --- | --- |
| `odoo_instancia_id` | uuid, nullable | FK a `odoo_instancias.id`; identifica URL/base/entorno. |
| `odoo_compania_id` | bigint, nullable | ID nativo de compañía; FK compuesta con instancia. Nullable para maestros compartidos. |
| `odoo_ultima_sync` | timestamptz, nullable | Última sincronización **confirmada** por el integrador. |
| `odoo_version` | text, nullable | Versión/fingerprint remoto para detección de conflictos; semántica definida por el adaptador. |

Campos específicos, además de los comunes:

| Tabla existente | Campos específicos nuevos | Modelo esperado |
| --- | --- | --- |
| `proveedores` | `odoo_id bigint` | res.partner |
| `articulos` | `odoo_product_id bigint`, `odoo_template_id bigint` | product.product / product.template |
| `categorias_inventario` | `odoo_id bigint` | product.category |
| `unidades` | `odoo_id bigint`, `odoo_factor numeric(24,12)` | uom.uom |
| `bodegas` | `odoo_location_id bigint`, `odoo_warehouse_id bigint` | stock.location / stock.warehouse |
| `ordenes_compra` | `odoo_id bigint` | purchase.order |
| `orden_compra_items` | `odoo_id bigint` | purchase.order.line |
| `proyectos` | `odoo_id bigint`, `odoo_analytic_id bigint` | project.project / account.analytic.account |
| `activos_fijos` | `odoo_id bigint`, `odoo_modelo text` | Acordar modelo operativo o contable en diagnóstico |
| `tec_equipos` | `odoo_id bigint`, `odoo_modelo text` | Acordar modelo operativo en diagnóstico |
| `vehiculos` | `odoo_id bigint` | fleet.vehicle |

Reglas:

- Cualquier metadato informado requiere instancia. IDs enteros positivos; compañía debe pertenecer a esa instancia.
- IDs de proveedor, variante, ubicación, OC/línea, proyecto y vehículo son únicos por instancia en sus tablas.
- Plantilla de producto y almacén ERP pueden compartirse; no tienen unicidad incorrecta.
- Categorías/unidades admiten aliases locales hacia la misma identidad ERP: su aceptación/conversión debe salir del diagnóstico.
- `odoo_factor` es el multiplicador **unidad SGC → unidad base acordada Odoo**, estrictamente positivo y finito; no se deriva del nombre. Confirmar redondeo y categoría de unidad antes de usarlo.
- Para activos/equipos, `odoo_modelo` es obligatorio cuando existe `odoo_id`; no se equipara automáticamente equipo operativo con activo contable. Su identidad puede compartirse cuando el modelo operativo lo justifique; no se impuso unicidad a ciegas.
- El entero nativo no es el XML/External ID ni un código visible. No inferirlo de un `odoo_ref` que parezca numérico.
- No rellenar las columnas desde un nombre parecido. Resolver contra la base/compañía correcta y registrar la evidencia.
- Los IDs directos de OC y línea son la autoridad para `purchase.order`/`purchase.order.line`. No duplicarlos como documentos auxiliares: esa relación está reservada a operaciones de stock.
- En clientes JavaScript, conservar `bigint` como cadena decimal o validar que sea entero seguro antes de convertirlo a `number`; no redondear identidades.

## 3. Tablas nuevas

| Tabla `sgc.*` | Uso y claves principales |
| --- | --- |
| `odoo_instancias` | Contexto de conexión sin credenciales. UUID; URL HTTPS normalizada sin ruta, query o usuario; base y entorno. URL/base/entorno inmutables: para cambiar identidad registrar otra instancia. Flags habilitada/entrada/salida=false. |
| `odoo_companias` | PK instancia + ID nativo de compañía. |
| `odoo_documentos` | Relaciones múltiples desde OC, entrada, salida, conduce externo, conteo o retiro a `stock.picking`, `stock.move` o `stock.scrap`, con etapa. |
| `odoo_lineas` | Correspondencia de líneas locales con `stock.move` o `stock.move.line`. Permite dividir una línea entre recepciones/parciales y verifica padre local al registrar. |
| `odoo_recepcion_asignaciones` | Relación explícita entre `detalle_entradas` y `orden_compra_items`, cantidad, unidad y factor; evita emparejar únicamente por artículo. |
| `odoo_eventos` | Outbox/inbox unificados por dirección; idempotencia, revisión, dependencia, correlación, estado y lease. |
| `odoo_intentos` | Historial de reclamaciones/resultados por evento, sin credenciales. |
| `odoo_cursores` | Checkpoint JSON por instancia/modelo/consumidor para lectura incremental. |
| `odoo_politicas` | Dueño por modelo/campo: SGC, Odoo o solo lectura; conflicto manual/rechazo. Deshabilitadas por defecto. |
| `odoo_conciliaciones` | Extracciones comparadas, fechas de ambas fuentes, filtros, resumen y decisión. |
| `odoo_desfases` | Equivalente, solo SGC, solo Odoo, diferente, ambiguo o no aplica; acción por lado y evidencia. |

Las claves de categorías/unidades se contrastaron como **integer** y las demás como **UUID** con el catálogo dev capturado el 15/10/2026. El preflight vuelve a comprobar tipos en la base de destino; no usa filas reales como fixture.

### Vínculos de documentos y líneas

Al insertar un documento se informa exactamente una FK local, instancia, modelo/ID Odoo y etapa. El trigger rellena `tipo_sgc`/`sgc_id`; no hay que inventarlos. Al insertar línea se informa exactamente una FK de línea y su documento; el trigger comprueba que el padre SGC coincide.

Un mismo picking puede enlazar la salida y la entrada vinculada como etapas del mismo traslado. Una entrada puede tener varios pickings por parciales. La relación no autoriza publicar ambos como operaciones físicas independientes.

**Los vínculos representan una instantánea verificada al registrar, no una garantía de que el padre nunca cambie después.** Para no bloquear ediciones legacy no se instalaron validadores de cambio de padre en las tablas de negocio. Antes de usar un vínculo, el adaptador debe releer el origen y ejecutar la comprobación equivalente a las consultas de 02_verify; si cambió el padre/orden, bloquear envío y conciliar. Un origen borrado conserva su UUID histórico y `origen_borrado_en`; no se reutiliza como activo.

`odoo_recepcion_asignaciones` no agrega una FK obligatoria a los detalles antiguos. Si la entrada ya tiene OC, verifica que la línea asignada pertenezca a ella. La suma de cantidades, conversión, unidad/producto compatibles, concurrencia y no sobreasignación deben validarse y bloquearse en la transacción del RPC que aplique la recepción; esta tabla por sí sola no acredita la recepción física.

## 4. Sincronización continua: contrato para el integrador

1. Ejecutar primero el diagnóstico [#18](https://github.com/techcsd/SGC/issues/18); persistir IDs y resolver faltantes [#19](https://github.com/techcsd/SGC/issues/19) en dev.
2. Elegir autoridad por campo/operación. Mantener SGC como autoridad operativa de stock hasta un corte explícito. No habilitar dos maestros que descuenten la misma existencia.
3. Dentro del **mismo RPC/transacción** que confirma el documento, insertar `odoo_eventos`. Una llamada posterior del navegador no es transaccional.
4. Usar clave idempotente estable por instancia/dirección/operación y revisión, payload inmutable de la etapa, agregado estable, compañía y dependencias. Cada agregado/dirección admite una sola acción por revisión; incrementar la revisión para la etapa siguiente. La restricción única evita duplicar el mismo evento en SGC.
5. Para entrantes, verificar la autenticidad fuera de SQL; registrar evento/versión y aplicarlo con el mismo control de autoridad/conflictos. `causa_evento_id` conserva correlación para evitar el eco de salida. La columna no implementa automáticamente el filtro anti-bucle.
6. Los campos de identidad son de edición restringida; solo un backend autorizado resuelve y guarda IDs. No publicar un documento con referencias/unidad/destino pendientes.
7. Releer cantidades recibidas: NULL no significa entrega completa ni faltante conocido. Validar la cadena real/prueba de cabecera, origen y líneas.
8. La idempotencia **en Odoo** requiere referencia única/acción verificada y reconciliación ante timeout. La unicidad SQL local no impide por sí sola un alta remota duplicada.
9. Un cursor Odoo debe conservar desempate de timestamp + ID y un solapamiento seguro; no asumir `updated_at` en todos los maestros SGC. Este esquema no añade esas columnas ni instala polling.
10. No escribir saldos de `stock_por_bodega`/`stock_apertura` para imitar Odoo. Validar recepciones/devoluciones con las acciones de negocio del ERP y conservar evidencia SGC.

### RPC privadas incluidas

- `odoo_v1_reclamar_eventos(p_instancia uuid, p_procesador text, p_limite integer=20, p_lease_segundos integer=120)`: devuelve filas completas. Límites 1–100 y lease 30–900 segundos. Usa `FOR UPDATE SKIP LOCKED`, respeta dirección habilitada/dependencia y no adelanta revisiones pendientes del mismo agregado/dirección.
- `odoo_v1_finalizar_evento(p_evento uuid, p_lease uuid, p_estado text, p_resultado jsonb=null, p_error text=null, p_reintentar_en timestamptz=null)`: token vigente obligatorio. Reintento requiere fecha futura.
- Estados: pendiente, procesando, completado, reintento, error, incierto, bloqueado, cancelado.
- Un lease vencido pasa a **incierto** en la siguiente reclamación; no se reenvía. Conciliar el resultado ERP antes de programar un reintento explícito.
- Antes de invocar la acción externa, comprobar que el lease sigue vigente y que no queda una llamada anterior sin resolver. El lease no cancela una petición HTTP remota que continúe ejecutándose. No reintentar una operación incierta hasta garantizar que la anterior terminó y resolver su resultado.
- Se marca completado únicamente al verificar el estado ERP final. Un wizard/acción pendiente o un HTTP 200 no son comprobación suficiente.
- El worker debe detectar dependencias cíclicas, serializar cambios incompatibles y evitar cambios de payload después de reclamar. Son responsabilidades del contrato de aplicación, no automatismos del DDL.
- Las cinco funciones restantes son triggers internos de protección/integridad. Las siete funciones son SECURITY INVOKER y no están concedidas a anon/authenticated.

## 5. Aplicación de la fase 1 en dev

Desde la raíz del repositorio, conservando la ruta del SQL para el ledger:

El ZIP contiene únicamente archivos nuevos para incorporar al checkout del proyecto. Requiere el repositorio SGC para usar `scripts/apply-migration.mjs` y su configuración autorizada; no incluye credenciales ni reemplaza archivos de la aplicación.

```bash
psql "$SGC_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/odoo-schema/00_preflight.sql
node scripts/apply-migration.mjs sql/20261016112524_odoo_identity_fields.sql --env dev --dry-run
node scripts/apply-migration.mjs sql/20261016112524_odoo_identity_fields.sql --env dev
psql "$SGC_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/odoo-schema/01_verify_identity.sql
psql "$SGC_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/odoo-schema/03_validate_constraints.sql
psql "$SGC_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/odoo-schema/01_verify_identity.sql
```

La fase 1 es suficiente para el siguiente trabajo: diagnosticar equivalencias, resolver faltantes y guardar IDs. No aplicar la ampliación para realizar esa tarea.

Cuando se implemente la cola y el adaptador, aplicar la ampliación en dev y utilizar `02_verify.sql`:

```bash
node scripts/apply-migration.mjs sql/20261016112525_odoo_sync_foundation.sql --env dev --dry-run
node scripts/apply-migration.mjs sql/20261016112525_odoo_sync_foundation.sql --env dev
psql "$SGC_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/odoo-schema/03_validate_constraints.sql
psql "$SGC_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/odoo-schema/02_verify.sql
```

La ampliación también admite instalarse directamente; el runner comprueba instalación directa, fase mínima aislada, reaplicación de ambas y ampliación desde la fase mínima. Mantener los dos archivos como migraciones independientes en el ledger; no aplicar fragmentos del SQL.

`SGC_DEV_DATABASE_URL` es una variable de sesión que el desarrollador proporciona desde su gestor de secretos; no existe como valor por defecto en el paquete. No imprimirla ni pegarla en issues. Se requiere rol administrador para el DDL y rol de lectura autorizado para preflight/verificación.

Si no tiene acceso SQL directo, ejecutar los scripts de **solo lectura** en SQL Editor del proyecto dev. La migración se aplica con el script del repositorio para registrar el checksum en el ledger. No cambiar la ruta/contenido después de registrar la migración sin volver a probar y registrar en dev.

No añadir `--env prod` al primer paso. La promoción posterior se realiza según `docs/ENTORNOS.md`, con prueba en `dev.sgcconstructorasd.com`, revisión y PR dev → main. El paquete se entrega sin ejecutar DDL remoto.

Repetir la migración idéntica es seguro en el escenario probado: columnas, índices, constraints y triggers no se duplican. Las colisiones de objetos/columnas ajenas se rechazan. No es un reparador de drift manual: comparar el esquema y el checksum si alguien modifica los objetos del paquete.

## 6. Verificación y reversión operativa

Ejecutar pruebas locales:

```bash
bash qa/odoo-schema/run.sh
node scripts/audit-notnull-sin-default.mjs
node scripts/audit-rpc-grants.mjs
```

La evidencia local y sus límites están en `VALIDACION.md`. El runner usa PostgreSQL desechable mediante socket privado, sin listener TCP; no usa Supabase, Docker ni datos reales. Arranca y detiene su propio clúster, aplica dos veces el SQL y prueba:
- Columnas/grants antiguos y ediciones legacy con `odoo_ref` y unidades históricas.
- Contexto/IDs/unicidad, plantilla compartida y aliases de unidades.
- Bloqueo de escritura técnica y cierre de grants heredados en tablas nuevas.
- Línea/cabecera, múltiples pickings por recepción y conservación tras borrar origen/línea/unidad.
- Idempotencia, orden, direcciones deshabilitadas, leases/tokens, resultado incierto.
- Dos consumidores concurrentes con eventos distintos.
- Ejecución de preflight/verificación y validación posterior de constraints.

La fixture usa formas mínimas de las tablas con los tipos/columnas relevantes; no reproduce todos los RPC/RLS de producción. Antes de promoción, probar en la web dev alta/edición de artículo, proveedor, bodega, OC y sus líneas, importación, recepción y despacho con los perfiles reales. El paquete no certifica todavía el worker, la API de Odoo ni el corte de stock.

**Reversión operativa:** mantener o volver a `habilitada=false`, `permitir_entrada=false`, `permitir_salida=false`. Antes de deshabilitar un worker activo, resolver o clasificar los leases/peticiones en curso. No borrar columnas/tablas para revertir; los datos y vínculos ya confirmados deben conservarse y cualquier compensación ERP debe trazarse.

## 7. Evidencia y referencias

- Esquema real inspeccionado el 15/10/2026: `docs/VALIDACION-ODOO-ESQUEMA-REAL.md`; este paquete no hizo una nueva consulta remota de datos.
- Catálogo dev de esa fecha: tipos contrastados de 20 PK. No inferir que la captura de ayer sustituye ejecutar el preflight actual.
- Fuentes oficiales: [ALTER TABLE PostgreSQL](https://www.postgresql.org/docs/17/sql-altertable.html), [grants y RLS Supabase](https://supabase.com/docs/guides/api/securing-your-api), [API Odoo](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).
- La instancia/versión/plan/campos reales de Odoo deben confirmarse en el diagnóstico; no se implementa escritura SQL directa sobre sus tablas.
