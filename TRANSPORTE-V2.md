# TRANSPORTE v2 — Documento de diseño (conduce-céntrico, rutas vivas, tracking, estados, Seguimiento)

> **✅ APROBADO por Xaviel (04/08/2026) con todas las recomendaciones. FASES 1-5 (web+BD)
> IMPLEMENTADAS.** Resumen de lo construido y contratos para PROMPT-4 al final (§14).

---

## 14. IMPLEMENTADO (SGC web+BD) — contratos para PROMPT-4 (app)

**Migraciones aplicadas a prod** (`sql/2026-08-04-af2*-transporte-v2-*.sql`):

- **FASE 1 — conduce-céntrico:** `conduce_fase(salida_id)` (fase derivada: emitido/
  en_transito/entregado/confirmado/pendiente_firma). `crear_conduce_transportista`
  (misma firma) **auto-genera ruta+parada** al emitir si hay vehículo+obra y no hay ruta
  (usa la ruta activa del chofer si existe; una sola). `conduce_tiene_alto_valor()` +
  `asignar_firma_pendiente` **bloquea auto-recepción** del chofer para ítems
  `entrega_en_mano` (AF16). Trigger `tg_conduce_entregado_marca_parada` ahora **cierra la
  ruta** cuando toda parada queda entregada.
- **FASE 2 — rutas vivas:** `ruta_eventos` (historial inmutable) + `agregar_parada_ruta`,
  `cambiar_destino_ruta` (cancelar = cambiar destino, se trackea). `rutas.documento_path`
  (AF24, jefe de flota). `rutas_activas_y_hoy()` (activas primero). `puede_modificar_ruta()`.
- **FASE 3 — estados del chofer:** `chofer_estado` + `chofer_estado_historial`;
  `set_chofer_estado(estado,texto)`; `choferes_estado()`. `marcar_ruta_estado` fija
  **En ruta automático** (y Disponible al terminar si no hay otra ruta en curso). Cron
  `sgc-reset-almuerzos` (cada 5 min) devuelve a Disponible tras 1h.
- **FASE 4 — tracking:** `chofer_posiciones` (breadcrumb) + `chofer_ultima_posicion`
  (realtime) + `gps_eventos`. `registrar_posiciones(jsonb)` (batch), `registrar_gps_evento`.
  RLS: chofer escribe la suya, leen flota-elevado/tecnología. Cron `sgc-purgar-posiciones`
  (diario) retiene **7 días**.
- **FASE 5 — Seguimiento (web):** `/flota/seguimiento` (flotaElevado): mapa Leaflet
  multi-marcador con última posición en vivo (realtime), color por estado, panel de rutas
  activas + lista de choferes con estado. Nav "Seguimiento" en Flota. Cubre también la
  lista de estados del jefe de flota (FASE 3.3).

**Contratos que la app (PROMPT-4) debe consumir:**
- Crear conduce ⇒ ya genera su ruta (no crear ruta aparte con el mismo destino).
- Emitir con **firma del emisor** (`firma_path`/`salida_firmas` rol emisor) — obligatoria.
- Entrega con **≥2 fotos** de descarga (validación app; backend acepta múltiples).
- **Alto valor**: `articulos.entrega_en_mano` → destacar el ítem y NO permitir auto-recepción
  (el server ya rechaza `asignar_firma_pendiente` a uno mismo).
- Estados del chofer: `set_chofer_estado`; almuerzo con countdown 1h (la app lo pinta).
- Tracking: `registrar_posiciones(jsonb)` en lotes (30–60 s en ruta); `registrar_gps_evento`
  para AF26; **bloquear crear/iniciar ruta, crear conduce y marcar entregas sin GPS**.
- Menú consolidado (§7) + crear-ruta ≤4 pasos (§6): implementación de UI en PROMPT-4.
- Push al asignar ruta: al asignar, llamar `notificar(chofer,…)` (ya empuja push, PROMPT-1).

**Pendiente de tu lista:** artículos a marcar `entrega_en_mano` (el dron + …).

---

> **Estado histórico (FASE 0): PROPUESTA aprobada.**
> Ronda 03/08/2026 (IDs AF), PROMPT-3. Este documento es la salida de la FASE 0
> (research + diseño). **No se implementa nada de las FASES 1-5 hasta que Xaviel
> apruebe.** Fuente: `imp 03082026\CONTEXTO.md` §F + AF14/15/16 de §D.
>
> Repos: **SGC** (web+BD, `dev\SGC`) es el padre; **csd-app** (`dev2\csd-app`) el hijo.
> Este prompt toca SGC (web+BD). El menú/UX de la app se implementa en PROMPT-4.

---

## 0. Resumen ejecutivo — lo clave que necesito que apruebes

1. **No reemplazamos el modelo; lo EXTENDEMOS.** Rutas, paradas, conduces, firmas y
   el vínculo ruta↔parada↔conduce **ya existen y funcionan** (AC7/AC13/AD6/AE5
   aplicados). El ciclo de vida rico que quieres se puede lograr **derivando** una
   "fase" a partir de señales que ya tenemos, sin romper conduces viejos.
2. **Decisión central a aprobar (§3):** el ciclo de vida del conduce como **fase
   derivada** (recomendado) vs. ampliar el `estado` con estados nuevos.
3. **Unificación conduce⇒ruta (§2):** al emitir un conduce con origen+destino se
   **auto-genera su ruta/parada**; ya no creas ruta Y conduce con el mismo destino.
4. **Menú consolidado (§7):** de 20 tiles a **3 núcleos** (Mis rutas · Conduces ·
   Seguimiento) + operativos sueltos. (Se implementa en PROMPT-4; aquí solo la propuesta.)
5. **3 cosas netas nuevas** (no existía nada): **tracking en vivo** (§8), **estados
   del chofer** (§9), **vista Seguimiento** (§10).
6. **Ítems marcados ⚠️** = necesito tu decisión antes de construir.

---

## 1. Auditoría — qué existe HOY (para no duplicar)

### 1.1 Conduce = `sgc.salidas_inventario`
- **`estado` tiene solo 3 valores:** `despachado` → `entregado` | `entregado_incompleto`.
  (No hay borrador/emitido/en_tránsito en el conduce; el "en camino" vive en la **parada**.)
- Columnas clave ya presentes: `conductor_id, vehiculo_id, ruta_id, ruta_parada_id`
  (AE5), `recibido_por/recibido_en, notas_recepcion, recepcion_foto_path`,
  `entregado_por/entregado_en, entrega_receptor/entrega_firma_path/entrega_foto_path`,
  `firma_pendiente_usuario_id/nombre/almacen`, **`firma_path`** (AF10, 04/08 — firma de
  QUIEN ENTREGA), `es_prueba`.
- RPCs: `crear_conduce_transportista` (chofer crea, valida stock, `estado=despachado`),
  `registrar_salida_app` (inventario, con `firma_path`), `entregar_conduce` (captura
  firma del receptor en la entrega; **definida en la app, no en este repo**),
  `confirmar_recepcion_salida` (recepción → `entregado`/`entregado_incompleto` +
  **auto-entrada** en el almacén de la obra destino), `asignar_firma_pendiente`.

### 1.2 Firmas (AC7) = `sgc.salida_firmas`
- **2 firmas por conduce**: `rol in ('emisor','receptor')`, `unique(salida_id, rol)`.
  RPC `firmar_conduce` (upsert). Bucket `conduces`. Pad: `signature-pad`.

### 1.3 Rutas + paradas (AC13 + AE5) — **aplicado**
- `sgc.rutas`: `estado in ('planificada','en_curso','completada','cancelada')`,
  `tipo in ('material','personal','traslado')` (AD6), coords origen/destino,
  `iniciada_at/finalizada_at`.
- `sgc.ruta_paradas` (multi-parada, N filas ordenadas): AE5 añadió
  `estado in ('pendiente','en_camino','entregada','omitida')`, `llegada_at,
  entregada_at, entregado_a, foto_path, firma_path, notas_entrega`.
- **Vínculo ruta↔parada↔conduce (AE5, ya existe):** `salidas_inventario.ruta_parada_id`;
  RPC `vincular_conduce_parada`; **trigger `tg_conduce_entregado_marca_parada`** que al
  pasar el conduce a `entregado`/`entregado_incompleto` marca su parada `entregada` y
  copia foto/firma/receptor. RPC `avanzar_parada` para paradas sin conduce.
- RPCs ruta: `chofer_crear_ruta` (con paradas), `crear_ruta_app` (single, elevado),
  `marcar_ruta_estado` (en_curso/completada/cancelada + tiempos), `set_ruta_paradas`
  (bulk, reconcilia por id preservando progreso), `mis_rutas_hoy`,
  `ruta_detalle_transporte` (paradas + conduces + notas de voz), `conduce_ruta_info`.

### 1.4 Web — qué ya tiene (NO duplicar, completar)
- **Historial de conduces**: `/inventario/conduces` (lista filtrable) + detalle
  completo `/inventario/salidas/:id/conduce` (items, firmas, fotos, traza de ruta,
  confirmación, imprimir). → **AF29 ya existe**; solo se completa.
- **Rutas**: `/flota/rutas` (crear/ver/editar, paradas con estado, conduces por parada,
  fotos, mini-mapa de destino, clima). Página madura.
- **Mapas**: Leaflet+OSM aislados en `mini-mapa` (punto) y `location-picker` (click).
  `RoutingService` (Google+OSRM) da km/min. Patrón realtime en
  `realtime-notificaciones.service.ts`. **Falta**: mapa multi-marcador en vivo + canal
  realtime de posiciones + estado de disponibilidad del chofer.
- `/flota/conductores-estado` existe pero es **solo licencias** (vigente/por-vencer);
  se puede **extender** con el estado de disponibilidad (§9).

### 1.5 App (csd-app) — menú actual (20 tiles) y solapamientos
- Tiles: Conduces y rutas · Hacer pre-uso · Registrar combustible · Registro de echadas ·
  Recibir mercancía · Sacar material · Devolver material · Compra en ferretería · Por
  firmar · Reporte semanal · Mi actividad · Asignarme vehículo · Recepciones de vehículo ·
  Vehículos · Conductores · Crear ruta · Historial de checklists · Multas · Avisos de flota ·
  (Documentación en proceso).
- **Solapamientos confirmados:**
  1. **"Crear ruta" duplicada**: tile propio + botón dentro de "Conduces y rutas".
  2. **Ciclo del conduce fragmentado en 3 tiles**: Sacar material (crear) → Conduces y
     rutas (entregar) → Recibir mercancía (confirmar).
  3. **"Recibir mercancía" = la pantalla "Recibir conduce"** compartida con Inventario.
  4. **"Por firmar"** se duplica con un banner del home.
- Geolocalización: `@capacitor/geolocation` presente pero **solo fixes puntuales**
  (crear-ruta, ETA, recepción de vehículo). **No hay tracking en segundo plano.**
- Push: `@capacitor/push-notifications` **ya cableado** (`PushService` → `registrar_device_token`).
- Outbox/borradores (AE9): Dexie + `EnProcesoService` + `sync.service`. Firmas: `signature-pad`.

### 1.6 Lo que NO existe (neto nuevo)
- **Tracking en vivo / tabla de posiciones** → §8.
- **Estado de disponibilidad del chofer** → §9.
- **Vista "Seguimiento" (mapa multi-vehículo en vivo)** → §10.
- **AF16 alto valor**: `articulos.entrega_en_mano` **ya existe** (04/08) pero **sin
  enforcement en BD** (hoy solo la app lo respeta). → §4 propone el enforcement server-side.

---

## 2. Principio rector y la unificación conduce ⇒ ruta

**Principios de Xaviel (§F del CONTEXTO):**
- *Ruta = movimiento del chofer.*
- *El conduce es el documento central de movimiento de material* (equivale a lo que
  hacen sacar material / recibir mercancía / devolver material).
- *No se crea ruta + conduce con el mismo destino.* Un conduce con **origen y destino**
  ya registra el movimiento: **genera su ruta**, y al **entregarse, finaliza**.
  (Ejemplo Bellón: al chofer le dicen "ve a Bellón"; llega y ALLÁ crea el conduce —
  ahí sabe qué mueve y hacia dónde—; sale al destino y al entregarlo el conduce finaliza.)

**Diseño propuesto (encaja con AE5 que ya existe):**
- **Un conduce SIEMPRE viaja en una parada de una ruta.** Al **emitir** un conduce:
  - Si el chofer **no** tiene una ruta activa → se **auto-genera una ruta** `tipo='material'`
    con **una parada = destino del conduce**, y el conduce queda vinculado a esa parada
    (`ruta_id` + `ruta_parada_id`). *Esto es lo nuevo: hoy el chofer crea ruta y conduce
    por separado; en v2 el conduce crea su ruta.*
  - Si el chofer **ya** tiene una ruta activa (multi-parada) → el conduce se **adjunta a
    la parada elegida** (reutiliza `vincular_conduce_parada`, ya existe).
- **Al entregarse el conduce**, el trigger `tg_conduce_entregado_marca_parada` (ya existe)
  cierra su parada. Si era la única parada → la ruta puede marcarse `completada`
  (nuevo: cierre automático de ruta de una sola parada cuando su conduce se entrega).
- Resultado: **no hay doble registro**. "Sacar material" deja de existir como flujo
  aparte; es "crear conduce" y este genera el movimiento (ruta) automáticamente.

⚠️ **A confirmar (Xaviel):** ¿el chofer puede tener **varias rutas activas** a la vez, o
solo una? (Recomendado: **una ruta activa**; un conduce nuevo sin ruta activa la crea, con
ruta activa se adjunta como parada.)

---

## 3. Ciclo de vida del conduce (AF23) — decisión de modelado

Estados que pide el CONTEXTO: **borrador → emitido (firma de quien entrega) → en tránsito
(ruta generada) → entregado (≥2 fotos descarga) → confirmado (checklist+foto+firma
receptor) | pendiente de firma (auto-recepción del chofer)**. Items de **alto valor**
bloquean auto-recepción.

Hoy el conduce solo tiene 3 `estado`s de stock. Dos formas de darle el ciclo rico:

### Opción A (RECOMENDADA) — **"fase" derivada**, sin tocar el `estado` de stock
Mantener `estado` (despachado/entregado/entregado_incompleto) para la semántica de stock,
y exponer una **`fase` calculada** por un RPC/vista a partir de señales que ya existen:

| fase | se deriva de |
|---|---|
| `borrador` | existe solo en el outbox de la app (aún no llega a BD) |
| `emitido` | fila en BD, `estado='despachado'`, tiene **firma emisor** (`salida_firmas` rol emisor o `firma_path`), sin ruta iniciada |
| `en_transito` | su parada está `en_camino` **o** su ruta está `en_curso` |
| `entregado` | `estado in ('entregado','entregado_incompleto')` **y** su recepción NO confirmada aún |
| `confirmado` | tiene fila en `recepcion_confirmaciones` (AF13, PROMPT-1) **o** `recibido_por` seteado |
| `pendiente_firma` | `firma_pendiente_usuario_id` seteado (auto-recepción del chofer) |

- **Ventaja:** cero riesgo para conduces viejos; nada que migrar; el `estado`/stock sigue
  siendo la fuente de verdad de inventario. La `fase` es una capa de lectura para la UI.
- Implementación: un RPC `conduce_fase(salida_id)` / columna calculada en
  `ruta_detalle_transporte` + un enum en TS.

### Opción B — ampliar el `estado` con estados nuevos
Cambiar el check a `('borrador','emitido','en_transito','entregado','entregado_incompleto',
'confirmado')`. Más "explícito" pero: cambia una constraint que usa toda la app/web,
obliga a mapear `despachado`→`emitido`, y arriesga romper lógica que compara `='despachado'`.

**Recomiendo A.** ⚠️ **Decisión tuya: A (fase derivada) o B (estado ampliado).**

---

## 4. Reglas del ciclo (AF16 alto valor, AF30 fotos, firmas)

- **Firma de quien entrega al emitir (AF23.3):** ya soportado — `firma_path` (AF10) y/o
  `salida_firmas` rol `emisor`. En v2 el **emitir exige** la firma del emisor.
  ⚠️ ¿obligatoria siempre, o se permite emitir sin firma y quedar "pendiente de emitir"?
  (Recomendado: **obligatoria** al emitir.)
- **Fotos de descarga obligatorias ≥2 (AF30):** hoy `entregar_conduce` guarda 1 foto.
  Propuesta: nuevo/extendido RPC de entrega que exige **mínimo 2 fotos** de la mercancía
  descargada (solo cámara, outbox), guardadas y visibles en el detalle y en la confirmación.
  ⚠️ mínimo exacto = **2** (asumido).
- **Alto valor / entrega en mano (AF16):** `articulos.entrega_en_mano` ya existe pero **sin
  enforcement en BD**. Propuesta: en el RPC de entrega/auto-recepción, si el conduce lleva
  algún ítem con `entrega_en_mano=true`:
  - **bloquear la auto-recepción del chofer** (no puede cerrarse con `firma_pendiente` del
    propio chofer ni "sin quien reciba");
  - exige **confirmación presencial del responsable** (o remota AF15 como excepción
    explícita y auditada);
  - el ítem se **destaca** visualmente en el conduce (dato ya disponible para la app).
  ⚠️ Lista inicial de artículos a marcar (el dron confirmado) — pendiente tu lista.
- **Confirmación (AF13/14/15):** reutiliza lo de PROMPT-1 — `registrar_confirmacion_recepcion`
  / `recepcion_confirmaciones` (checklist + fotos + modo presencial/remota), permisos
  `puede_confirmar_recepcion` (capataz por flag) y `puede_confirmar_remoto` (Raykler/Eduardo).

---

## 5. Orígenes y destinos del conduce (AF31)

- **Obra = almacén** (AF24): un solo selector de destinos = obras/proyectos (sin lista de
  "almacenes" aparte). *En la app, hoy "Sacar material" usa pickers separados bodega vs obra;
  se unifican en PROMPT-4.*
- **Origen "ubicación actual" (AF31.1):** nunca coordenada suelta. Resolución por **geocerca
  a la obra más cercana con confirmación explícita** ("¿Estás en la obra X?"). Si no hay obra
  cercana → cae a "Otros". *Esto protege la continuidad salida-origen/entrada-destino.*
- **Origen ferretería (AF31.2/AF32):** select de proveedores marcados `is_hardware_store`
  (RPC `ferreterias_visibles`, PROMPT-1). Un conduce con origen ferretería **NO es un
  movimiento entre obras: registra una ENTRADA (compra)** — reutiliza el flujo ferretería
  (`chofer_registrar_compra_ferreteria`) embebido en crear conduce.
- **"Otros" (AF31.3):** nombre manual + coordenada actual (aquí sí se toma la ubicación).
- **Suplidor como destino (AF31.4):** para devolver equipos alquilados
  (`articulos.propiedad='alquilado'`, ya existe) — el destino ofrece el proveedor/suplidor.
  ⚠️ ¿el suplidor se modela como un proveedor destino (reutilizar `proveedores`) o como
  "Otros"? (Recomendado: **proveedor**, para trazabilidad.)

**Continuidad de inventario (FASE 1.4):**
- origen-obra ⇒ **salida** en esa obra.
- destino-obra ⇒ **entrada pendiente de confirmar** (ya lo hace `confirmar_recepcion_salida`
  con la auto-entrada T15).
- origen-ferretería ⇒ **entrada nueva** (compra).
- Sin dobles registros: se verifica contra los módulos de inventario existentes.

---

## 6. Rutas vivas (AF25)

- **Multi-parada** ya existe (AC13/AE5). Falta el "algo vivo":
  - **Agregar parada a mitad de ruta** → reutiliza `set_ruta_paradas` (reconcilia por id,
    preserva progreso). Nuevo: permitirlo con ruta `en_curso`.
  - **Cambiar destino ≠ cancelar** (AF25.2): "cancelar" cambia el destino; se **trackea**.
    Propuesta: **tabla de eventos inmutable** `ruta_eventos` (parada_agregada,
    destino_cambiado, parada_omitida; quién, cuándo, dónde/coords). El `estado='cancelada'`
    se reserva para cancelación real (rara); el flujo normal es cambio de destino.
  - **Listado "Rutas activas" + "Rutas de hoy"** (activas primero) — vista/RPC nuevo
    (`rutas_activas_y_hoy`) que la app y la web consumen.
- **Crear ruta v2 ≤4 pasos (AF24, se implementa en PROMPT-4):** propuesta de pasos
  1) destino(s)/paradas · 2) carga + conduce(s) · 3) **foto de carga obligatoria** (se
  elimina la foto de vehículo del contrato, retrocompatible) · 4) resumen. Buscador de
  proyectos. Borrador persistente (AE9). **Documento adjunto solo jefe de flota/admin**
  (ej. factura) — nuevo campo `ruta.documento_path` + gate.

---

## 7. Menú consolidado de Transporte (AF22) — propuesta

> Se implementa en **PROMPT-4** (app). Aquí solo la propuesta + mapa viejo→nuevo.

**Núcleos (3):**
- **Mis rutas** — Rutas activas / Rutas de hoy / Historial. Crear ruta y agregar parada son
  **acciones dentro**, no tiles sueltos. (Absorbe *Conduces y rutas* + *Crear ruta*.)
- **Conduces** — Crear conduce (genera ruta) · Recibir · Devolver · Compra en ferretería ·
  Por firmar · Historial. (Absorbe *Sacar material* + *Recibir mercancía* + *Devolver
  material* + *Compra ferretería* + *Por firmar*.)
- **Seguimiento** — solo jefe de flota (nuevo, §10).

**Operativos que quedan como tiles propios** (no son conduce/ruta): Asignarme vehículo
(pre-uso unificado), Registrar combustible, Registro de echadas (elevado), Reporte semanal,
Mi actividad, Historial de checklists, Multas, Avisos (elevado), Recepciones de vehículo,
Vehículos/Conductores (elevado).

**Mapa viejo→nuevo (redirects):** Sacar material→Conduces/Crear; Recibir mercancía→Conduces/
Recibir; Crear ruta→Mis rutas/Crear; etc. ⚠️ **Tú validas el menú final.**

---

## 8. Tracking en tiempo real (AF26/AF27) — neto nuevo

**Backend (SGC, FASE 4):**
- Tabla `sgc.chofer_posiciones` (`usuario_id, vehiculo_id, lat, lng, precision, bateria,
  capturado_en, es_prueba`) — breadcrumb. + tabla/vista `chofer_ultima_posicion` (última
  por usuario) para el mapa.
- **Retención** ⚠️: breadcrumb se purga con cron (propuesta: **7 días**); última posición
  se conserva. Confirmar.
- Ingesta **batch** vía RPC `registrar_posiciones(p jsonb)` (la app manda lotes offline-first).
- **Canal realtime** sobre `chofer_ultima_posicion` (patrón `realtime-notificaciones`).
- **RLS:** el chofer escribe **solo la suya**; leen **jefe de flota/admin/tecnología**.
- Registro server-side de **lapsos sin GPS** (para AF26 + auditoría): tabla/campo de
  "gps_apagado_desde/hasta" o eventos.

**App (PROMPT-4):**
- Plugin de **background/foreground service Android** — propuesta:
  **`@capacitor-community/background-geolocation`** (foreground service con notificación
  persistente). ⚠️ a validar en device.
- **Frecuencia** ⚠️: propuesta **cada 30–60 s en ruta activa**, más espaciado fuera de ruta;
  batch cada N fixes. Balancear batería/datos.
- **iOS PWA:** sin background real → se documenta el límite; captura solo en foreground +
  fallback in-app.
- **AF26 ubicación siempre activa:** detección de GPS apagado/permiso revocado (usa
  `PermissionsService`), **banner persistente** + **bloqueo de funciones de transporte**
  (crear/iniciar ruta, crear conduce, marcar entregas) hasta reactivar; telemetría Y6.
  ⚠️ Lista exacta de funciones bloqueadas.

---

## 9. Estados del chofer (AF28) — neto nuevo

- **Modelo:** `sgc.chofer_estado` (estado actual por usuario) + `chofer_estado_historial`
  (quién, cuándo, desde dónde). **6 estados:** `disponible, en_ruta, descanso, almuerzo,
  inactivo, otros` (otros pide texto).
- **Reglas server-side:**
  - `en_ruta` **automático** al `marcar_ruta_estado(en_curso)`; vuelve a `disponible` al
    `completada`.
  - `almuerzo` registra `inicio`; el **countdown de 1h** lo pinta la app; al vencer →
    `disponible`. ⚠️ **¿automático al vencer, o requiere confirmación?** (asumido automático.)
  - `inactivo` al cierre del día; `disponible`/activo en la mañana (lo marca el chofer).
- **Web:** visible en la **lista de choferes del jefe de flota** — se **extiende
  `/flota/conductores-estado`** (hoy solo licencias) y alimenta el Seguimiento (§10).
- ⚠️ **¿a qué roles aplica** además de choferes? (asumido: solo choferes.)

---

## 10. Vista "Seguimiento" / "Control de rutas" (web, AF27, FASE 5)

- Para **jefe de flota / admin / tecnología**. Ruta nueva `/flota/seguimiento`
  (`flotaElevadoGuard`), tile "Seguimiento" en el nav de Flota.
- **Mapa** (Leaflet/OSM, reutiliza el aislamiento de `location-picker`/`mini-mapa`, ampliado
  a **multi-marcador + polilínea de ruta**): última posición de cada chofer/vehículo +
  **estado** (§9) + **ruta activa** (paradas, progreso, modificaciones §6) + **conduces en
  tránsito**. Realtime (§8).
- **Panel lateral:** lista de choferes con estado, ruta y última actualización; click → detalle.
- **Push al chofer al asignarle ruta** (infra PROMPT-1: `notificar` ya empuja push).
- Verificación: chofer simulado moviéndose se ve en vivo; cambio de destino a mitad se refleja.

---

## 11. Matriz de visibilidad de conduces (AF23) — ⚠️ tú validas

Base en la RLS actual + lo que pide el CONTEXTO. Propuesta:

| Rol | ¿Ve el conduce? |
|---|---|
| **Emisor / creador** | ✅ los suyos |
| **Chofer asignado** | ✅ los que lleva |
| **Jefe de flota / admin / dirección / gerencia** | ✅ todos |
| **Módulo inventario / almacén** | ✅ (recepción/stock) |
| **Responsable de obra destino** (miembro `proyecto_empleados`) | ✅ los que llegan a su obra |
| **Capataz** (flag `can_confirm_reception`) | ✅ para confirmar en su obra |
| **Otro usuario ajeno** | ❌ |

Ya cubierto por las políticas actuales de `salidas_inventario` salvo el **responsable de
obra destino explícito** (hoy es "miembro del proyecto"): ⚠️ ¿basta con `proyecto_empleados`
o quieres un "responsable de obra" designado?

---

## 12. Plan por fases (tras tu aprobación) y handoff a PROMPT-4

- **FASE 1** — Modelo/RPCs conduce-céntrico: `conduce_fase` (opción A), auto-generación
  ruta al emitir, enforcement AF16 alto valor, entrega ≥2 fotos (AF30), origen ferretería/
  otros/suplidor, continuidad inventario. RLS matriz §11.
- **FASE 2** — Rutas vivas: `ruta_eventos` (historial inmutable), `rutas_activas_y_hoy`,
  `ruta.documento_path` (jefe de flota), crear-ruta v2 backend (foto carga obligatoria).
  Completar historial de conduces web (no duplicar).
- **FASE 3** — Estados del chofer: `chofer_estado`+historial, reglas automáticas, extender
  `/flota/conductores-estado`.
- **FASE 4** — Tracking: `chofer_posiciones`+`chofer_ultima_posicion`, `registrar_posiciones`,
  realtime, RLS, lapsos sin GPS.
- **FASE 5** — Vista Seguimiento web (mapa vivo + panel + push).
- **Contratos documentados para PROMPT-4** (app): crear conduce⇒ruta, emitir con firma,
  entrega ≥2 fotos, `registrar_posiciones`, estados del chofer, menú consolidado, crear-ruta
  ≤4 pasos, AF26 bloqueo por GPS.

---

## 13. ⚠️ Decisiones que necesito de ti antes de implementar

1. **§3** — Ciclo de vida: **A (fase derivada, recomendado)** o B (ampliar `estado`).
2. **§2** — ¿El chofer puede tener **varias rutas activas** o solo una? (rec: una).
3. **§4** — ¿Firma del emisor **obligatoria** al emitir? (rec: sí). Mínimo de fotos de
   descarga = **2** (asumido). Lista inicial de artículos **entrega_en_mano** (el dron +…).
4. **§5** — Suplidor destino: **proveedor** (rec) u "Otros".
5. **§7** — ¿Apruebas el **menú consolidado** (Mis rutas / Conduces / Seguimiento)?
6. **§8** — Retención de posiciones (rec: 7 días), frecuencia (rec: 30–60 s en ruta),
   lista de funciones bloqueadas sin GPS.
7. **§9** — Almuerzo: ¿vuelta a Disponible **automática** al vencer 1h? ¿Estados solo para
   choferes?
8. **§11** — Matriz de visibilidad: ¿basta `proyecto_empleados` como "responsable de obra
   destino"?

> **No avanzo a FASE 1 hasta tu OK.** Dime "aprobado" (o los ajustes por número) y arranco.
