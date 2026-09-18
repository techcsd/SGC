# Checklist de migraciones SGC (reglas de nacimiento)

Toda migración fechada en `sql/` debe cumplir estas reglas antes de aplicarse a prod.
**Tres** de ellas están **automatizadas en `prebuild`** y **fallan el build** si se violan
(NOT NULL sin default, embeds ambiguos, y buckets con upsert sin UPDATE).

## 1. NOT NULL nace con default o backfill (BF1) — automatizado
Toda columna **NOT NULL nueva** debe nacer con `DEFAULT` **o** con un `UPDATE ... SET col`
de backfill en la **misma** migración.

- **Por qué:** en Postgres un `null` explícito en un INSERT **anula** el DEFAULT (el
  default solo aplica cuando la columna se **omite**). Una columna NOT NULL sin default
  revienta el primer INSERT que la omita o le mande null.
- **Caso real (BF1):** crear proveedor → `null value in column "is_hardware_store" ...`.
  La columna sí tenía `default false`, pero el formulario mandaba `null` explícito.
- **Guarda:** `scripts/audit-notnull-sin-default.mjs` (escaneo estático de `sql/`).
- **Defensa extra en tablas calientes:** trigger `BEFORE INSERT/UPDATE` que coalescea el
  campo a su default, para que ningún cliente (web, app, imports, Compa) pueda reventar
  por un null explícito. Ver `sql/2026-09-01-bf1-proveedores-null-guard.sql`.

## 2. Tabla/columna nueva con RLS tiene camino de escritura por rol (BC7) — auditable
Toda tabla nueva con RLS activa necesita **política INSERT/UPDATE por rol** o un **RPC
`SECURITY DEFINER`** con gate de matriz que la alimente (si no: `permission denied for
table…`). Ver `ROLES.md §6.1`.

- **Guarda:** `scripts/audit-rls-tablas-nuevas.mjs` (on-demand, necesita DB).

## 3. Estado nuevo ⇒ constraint/enum actualizado en la MISMA migración (BG5)
Al añadir un valor de `estado` (o cualquier columna con `CHECK (col in (...))` o enum) que
el código va a escribir, **recrear el constraint con la lista completa en la misma
migración** + smoke de **cada transición**.

- **Por qué:** el código puede escribir un estado nuevo, pero si el `CHECK` de la tabla no
  lo incluye, el `UPDATE`/`INSERT` revienta con `violates check constraint`.
- **Caso real (BG5):** BA6 añadió `por_despachar`/`parcial`/`completada`/`cancelada` en los
  RPCs, pero `solicitudes_material_estado_check` seguía con los 5 originales → cancelar
  REQ-000026 explotaba. Fix: `sql/2026-09-01-bg5-requisicion-estado-constraint.sql`.
- **Regla de amplitud:** ampliar la lista nunca viola filas existentes (es aditivo);
  restringirla sí — no quites valores sin migrar los datos.
- **Auditoría (01/09/2026):** revisadas las demás máquinas de estado con `*_estado_check`
  (`salidas_inventario`, `rutas`, `ruta_paradas`, `conduces_externos`, `ordenes_compra`,
  `chofer`) — todas al día con los estados que su código escribe. La única desactualizada
  era `solicitudes_material`. Repetir esta auditoría al tocar cualquier máquina de estado.
- **Manejador global (BF1/PROMPT-26 F1.3):** `friendly-error.util.ts` ya mapea `23514`
  (check violation) a mensaje humano ("Alguno de los datos no es válido") — red de
  seguridad mientras el constraint no esté al día; el fix real es siempre el constraint.

## 3.5 Ninguna acción se pinta si el guard la va a negar (BH1) — enfermedad recurrente
Toda condición de visibilidad de un botón cuya RPC pueda responder "no autorizado" se
**deriva de la MISMA regla que aplica el servidor**, no de una fuente distinta. El bug se
repite tanda tras tanda: AU8 (menú que da 403) → AV1 (despachante inelegible) → BF7 (chofer
sin obras) → **BH1** (al autor se le ofrecía "Rechazar" y el servidor lo negaba con
"No puedes rechazar tu propia solicitud").
- Espeja en el front la condición exacta del servidor (p. ej. `puedeRechazar = puedeGestionar
  && pendiente && (!esAutor || esAdmin)` ⇆ `rechazar_solicitud_material`).
- Si dos conceptos comparten una función de permiso, **sepáralos** (BH1 partió
  `puede_gestionar_requisicion` = aprobar/rechazar/cerrar, de
  `puede_disponer_de_mi_requisicion` = editar/cancelar).
- **El smoke se corre desde la cuenta que sufre el caso** (el autor, el chofer, el capataz),
  no solo desde admin.

## 4. Grants de schema y secuencias
Al crear tabla/función/secuencia en `sgc`, verificar `grant` a `authenticated`/`service_role`
según corresponda (bugs históricos: `permission denied for schema sgc`,
`permission denied for sequence roles_id_seq`).

## 5. RPCs de escritura para roles no-admin → `SECURITY DEFINER`
Gemelo del gate de módulo. La guarda `verify-regresiones.mjs` exige `security definer`
en RPCs marcados y detecta el cierre `$function$`.

## 6. Aditivo y retrocompatible
`add column if not exists`, `create ... if not exists`, `create or replace`. Nunca romper
un contrato que la app (csd-app) ya consume — **paridad web↔app**.

## 7. Todo bucket usado con `upsert: true` nace con INSERT *y* UPDATE (BI1) — automatizado
Cualquier bucket de Storage al que la app/web suba con `upsert: true` necesita **política
INSERT y UPDATE** en `storage.objects`.

- **Por qué:** la subida es idempotente por ruta determinista. El **1er intento** es un
  `INSERT` (permitido); **todo reintento** re-sube la misma ruta → Storage ejecuta un
  `UPDATE` → sin política UPDATE, `new row violates row-level security policy`. El error se
  ve en la app como envío atascado en "Pendientes", y NO es del recurso de negocio (bitácora,
  conduce): es de la **foto que se re-sube**.
- **Caso real (BI1):** `sgc-bitacora` fue el único de los buckets de campo que nunca recibió
  UPDATE → las bitácoras reales del ingeniero (Jonathan Roman) quedaron atascadas desde el
  20-ago, con las fotos ya en Storage. La regla YA estaba escrita en dos migraciones
  (`flota-documentos`, `bg4-retiro`) y aun así se saltó un bucket → **por eso ahora es un
  script, no una nota.** El mismo auditor encontró además `sgc-documentos` y `sgc-rrhh`
  (gaps reales) y `sgc-mensajes`/`sgc-cronograma` (existían en prod pero no en `sql/`).
- **Guarda:** `scripts/audit-buckets-upsert-policy.mjs` (escaneo estático de ambos repos +
  `sql/`, en `prebuild`). Rompe el build si un bucket con upsert:true no tiene UPDATE.

## 6.5 Un flag apagado o una función sin llamadores es DEUDA, no feature (BJ3) — automatizado
Un feature detrás de un **flag apagado por defecto**, o una **función/export sin
llamadores**, NO es un feature — es deuda que se pudre en silencio.

- **Todo flag** de `sgc.parametros` que un gate lea **nace con su fila creada por la
  migración** (si no, el gate lee un parámetro inexistente → feature apagado por
  accidente; fue BJ3: `conduce_wizard_web_habilitado` llevaba semanas apagado). Su
  condición de retiro va escrita y una línea en `PARIDAD.md` mientras esté encendido
  por flag. Convención: los **flags booleanos** terminan en `_habilitado`/`_activo`/
  `_enabled`/`_flag` (los umbrales numéricos con `coalesce(...,default)` NO son flags).
- **Ningún export de servicio queda sin llamador** (fue BJ3: `crearConduceSimple()`
  con cero llamadores por semanas). Al borrar el último llamador, borra el export.
- **El VALOR del flag también cuenta, no solo que la fila exista** (auditoría 13-sep,
  root cause de BJ3): un `insert … 'true' … on conflict (clave) do nothing` sobre una
  fila que una migración anterior sembró en `'false'` es un **no-op silencioso** — la
  fila existe (check A pasa) pero con el valor equivocado, y el feature queda apagado
  aunque el repo "diga" que se encendió. **Para CAMBIAR el valor de un parámetro** usa
  `on conflict (clave) do update set valor = excluded.valor` o un `update sgc.parametros
  set valor=… where clave=…` explícito — nunca otro `insert … do nothing`.
- **Guarda:** `scripts/audit-flags-exports-muertos.mjs` (prebuild). Falla si (a) un
  flag `_habilitado`/… se lee sin `INSERT` en `sgc.parametros`, (b) aparece un
  dead-export **nuevo** (ratchet contra `scripts/.dead-exports-baseline.json`; tras
  una limpieza intencional, regenerar con `--update-baseline`), o (c) un **flag cambia
  de valor y el cambio se pierde** por `on conflict do nothing` (simula el valor
  efectivo cronológicamente por `sql/`; los conflictos aceptados a propósito se listan
  en `ACCEPTED_FLAG_VALUE_CONFLICTS` con su razón — hoy `conduce_wizard_web_habilitado`,
  apagado por decisión). Los umbrales numéricos re-sembrados dan solo aviso, no rompen.

## 8. El smoke de un flujo con outbox REINTENTA (regla de verificación de cierre, BI) — obligatoria
Un smoke que sólo prueba el **camino feliz** (INSERT en ruta nueva) y da verde es **peor que
no tener smoke**: cerró la investigación de BG2 en falso, y sobre ese verde se publicó una
señal de fix inexistente.

- **Regla:** todo smoke de un flujo con outbox (fotos + reintento) corre **dos veces seguidas
  sobre la MISMA carga** (mismas rutas). La **segunda pasada** — el `upsert` que ejecuta un
  `UPDATE` — **es la que cuenta**. No basta con que la RPC devuelva OK.
- **Aplicado en:** `scripts/smoke-bitacora-app-prod.mjs` (sube → RPC → **re-sube las mismas
  rutas** → exige que la 2ª pasada pase). Repetir el patrón en cualquier smoke de flujo con
  fotos + outbox (retiro BG4, recepción, ficha de personal).
- **Verificación de rescate:** cuando el criterio de éxito es "la data llega", **contar** lo
  que llegó contra lo declarado (p. ej. fotos en Storage vs. las que el parte declara), no
  sólo que la RPC no falló — una bitácora entra con 3 de 10 fotos porque el mínimo del
  servidor es 2.

## 9. Un rechazo de NEGOCIO no puede llevar un SQLSTATE de INFRAESTRUCTURA (BM1) — la 9ª regla
El **código de error ES el contrato** entre el RPC y el cliente del outbox
(`csd-app/.../outbox-categoria.ts`). `23514` significa *"un CHECK de la BD está mal"* y
`42501` *"falta una política/grant"* → la app los clasifica como categoría **`sistema`**:
*"ya quedó reportado a Tecnología, podrás reintentarlo cuando se publique la corrección"*.

- **BM1 fue el costo:** los 5 rechazos de negocio de `registrar_combustible_app` (galones
  sobre capacidad, precio fuera de banda, odómetro < lectura viva, salto de km, "ese vehículo
  no es tuyo") viajaban con `23514`/`42501` → un rechazo **correcto** se presentó como avería,
  el chofer quedó esperando un fix inexistente y la telemetría (BG2) contó falsos positivos.
- **Regla:** cuando un RPC quiere decirle algo **al usuario**, usa el **canal de datos** que el
  cliente ya honra — `sgc.error_campo(campo, motivo, mensaje)` (**22023**, activa *"Corregir"*)
  cuando hay un campo que arreglar, o un **código de dominio `DRxxx`** (permanente + accionable)
  cuando no lo hay. Los códigos de infraestructura (`22|23|42`) quedan **para infraestructura**.
- **Al tocar un RPC:** ningún `raise … using errcode='23514'|'42501'|'22001'` puede ser en
  realidad una regla de negocio. Auditar con `grep "errcode = '23514'\|'42501'"` en `sql/` y
  separar negocio de infraestructura **antes** de cambiar en masa (FASE 1.4 de BM). DR481 =
  "solo el usuario asignado puede echar combustible" (registro de dominio junto a DR409/45x/46x/47x).

### 5-bis. Un bucket usado con upsert que no está DECLARADO en `sql/` rompe el build (BM2)
El auditor de buckets sólo veía buckets **declarados en `sql/`** → `vehiculos` (todas las fotos
de combustible), `conduces` e `inventario`, creados desde el dashboard, eran **invisibles**
(sin auditar la UPDATE, sin límite de tamaño). *"No declarado" ya NO significa "está bien"*:
`scripts/audit-buckets-upsert-policy.mjs` rompe el build hasta que el bucket se declare en
`sql/` (INSERT + INSERT/SELECT/UPDATE policies + `file_size_limit`). Plantilla:
`sql/2026-09-09-bm2-buckets-*.sql`.

### 5-ter. La sobrecarga VIVA de un RPC del cliente necesita grant a authenticated (BM4)
AW3 creó `registrar_combustible_app(20 args)` y sólo otorgó sus ayudantes → la RPC de 20 args
vivía del `EXECUTE TO PUBLIC` por defecto de Postgres; si se revoca → `42501` → la app lo pinta
*"Problema del sistema"* (BM1 otra vez). **Guarda:** `scripts/audit-rpc-grants.mjs` (prebuild)
rompe si un RPC que el cliente llama por `.rpc('X')` no tiene **ningún** `grant … to authenticated`
en `sql/`. La verificación de **aridad** exacta (¿el grant cubre la sobrecarga viva?) es estática
y sólo aproximada — `--report` la lista; la firma viva se confirma contra `pg_proc` en prod.

## 10. Un `as` sobre `form.value` no es un tipo: es permiso para mandar un campo que no existe (BN3)
El payload de una escritura se construye **campo por campo**, no con `const payload = this.form.value as XxxFormData`.

- **Por qué:** un `FormGroup` mezcla controles que son **columnas** con controles que son **estado
  de pantalla** (un toggle "heredar", un filtro, un "confirmar"). El chequeo de propiedades
  excedentes de TypeScript **sólo aplica a literales**, así que `form.value as XxxFormData` **NO
  quita** el control de más — lo deja pasar. PostgREST recibe una clave que no es columna y
  **rechaza la fila entera** con un 400: un control de UI en el payload no degrada el guardado,
  **lo mata**.
- **Caso real (BN3):** el form de almacenes tenía `heredar_ubicacion` (estado de pantalla; la
  columna real es `ubicacion_hereda_proyecto`, que fija el RPC `set_bodega_ubicacion`). El
  `const payload = this.form.value as BodegaFormData` lo mandaba al `.insert`/`.update` → crear y
  **editar almacenes rotos en producción**.
- **Regla (doble filtro):** (a) el componente arma el objeto **explícito** con `getRawValue()` y
  **sólo** las columnas, sin `as` (tipa el destino de verdad para que el compilador avise); (b) el
  **servicio también filtra** por lista blanca de columnas antes de `.insert`/`.update` — un
  servicio que reenvía lo que le dan convierte cualquier descuido de UI en un 400 en la cara del
  usuario. Patrón: `pickBodegaFields()` en `bodegas.service.ts`.
- **Barrido BN3 (09/09/2026):** de 10 sitios `form.value as XxxFormData`, **ninguno es bomba viva
  hoy** (todos los controles son columnas), pero **9/10 reenvían el payload crudo sin lista
  blanca** → cargados y sin seguro: el día que alguien agregue un control de pantalla a esos forms,
  es un 400 instantáneo. Candidato a guarda de `prebuild` (flag a `form.value as` que alimenta un
  `.insert/.update` sin `pick`).

## 11. Si el `cron.schedule` no está en `sql/`, el trabajo no existe (BM2 un nivel arriba, BN5)
Todo cron **vive en una migración de `sql/`**, no registrado a mano desde el dashboard.

- **Por qué:** un job creado desde el dashboard funciona hasta que alguien reconstruya el proyecto,
  y entonces **desaparece sin un error**. Lo que no está declarado en el repo **no se puede
  auditar, ni restaurar, ni revisar en un PR** — es la regla 5-bis (buckets) un nivel más arriba.
- **Caso real (BN5):** dos jobs corrían en prod fuera del repo — `sgc-incentivo-diario` (su
  migración BK4 terminó en `commit;` sin `cron.schedule`) y `outbox-atascados-diario` (su
  `cron.schedule` quedó **comentado** en BG2, "HELD para Xaviel"). Un `cron.schedule` **comentado**
  cuenta como no declarado. Rescatados en `sql/2026-09-09-bn5a-crons-huerfanos.sql`.
- **Regla:** al crear un cron, su `do $$ … cron.unschedule(...) … $$` + `cron.schedule(...)`
  idempotente va **en la misma migración** que crea la función (patrón en
  `2026-08-31-be1-resumen-operaciones-cron.sql:64-66`), y se añade la fila a `docs/CRONS.md`.
  Fuente de verdad: `select jobid, jobname, schedule, command, active from cron.job` — reconciliar
  las tres direcciones (prod ↔ `sql/` ↔ `CRONS.md`). RD = UTC−4 sin DST (`0 12 * * *` = 8 AM RD).

## 12. Cuando un modelo reemplaza a otro, el viejo se retira o se documenta quién lo sigue leyendo (BO1/BO2)
Toda migración de modelo **nace con la lista de sus lectores y una fecha de retiro del puente**.

- **Por qué:** dejar el modelo viejo como *"puente legacy"* sin inventariar quién lo lee es una bomba
  de tiempo. `vehiculo_asignaciones` fue sustituida por `vehiculo_usos`, la migración dejó
  `vehiculos.responsable_id` como puente y **nadie hizo el inventario de lectores** → dos pantallas
  quedaron preguntando por el modelo muerto (una se arregló, otra siguió rota en prod). Además, el gate
  de combustible cae a `vehiculos.responsable_id` cuando no hay asignación activa, y ese campo lo
  reescribe `iniciar_uso_vehiculo` cada vez que alguien toma un vehículo → basta tomarlo una vez para
  quedar clavado a él (BO2).
- **Regla:** el `comment on column/table` del puente **nombra la migración** donde vive el inventario;
  esa migración lista **LECTORES** (quién sigue leyendo el campo viejo), **ESCRITORES** (quién ya migró
  al nuevo) y una **FECHA/RONDA DE RETIRO**. Mientras el puente viva, un trigger lo mantiene sincronizado
  y **nadie escribe el campo viejo directo**.
- **Caso real (BO1):** `bodegas.es_principal` significaba tres cosas (central global / desempate por obra
  / "es central"). Se partió en `es_central` + `es_principal_obra` (`sql/2026-09-13-bo1-almacen-split-central-obra.sql`);
  `es_principal` quedó como puente de **solo lectura** sincronizado por trigger, con sus 8 lectores y su
  fecha de retiro documentados en esa migración.

## 13. Un trigger que ESCRIBE una tabla es un escritor más de esa tabla (BP1)
Todo escritor nuevo de una columna —incluido un **trigger**— se registra en el **inventario de
escritores** de esa columna, en el comentario de la migración. Y en una **edge** que orquesta varios
pasos sobre tablas con triggers, **el orden de los pasos es parte del contrato**.

- **Por qué:** es la regla 12 vista desde el otro lado (lectores del modelo viejo → **escritores del
  modelo vivo**). AI9 (7-ago) añadió `trg_usuarios_roles_asegura_conductor`, que escribe
  `conductores.usuario_id` desde un INSERT en `usuarios_roles`. La edge `conductor-crear-acceso` (jul)
  escribía ese mismo campo **dos pasos más tarde** en el mismo flujo, sin que nadie inventariara que
  ahora había DOS escritores. Al dar acceso a un conductor con la cédula con guiones, el trigger fabricó
  una ficha fantasma y el enlace de la edge chocó con `uq_conductores_usuario`. Reintentar no servía: el
  fantasma ya tenía el `usuario_id`.
- **Regla:** al añadir un trigger que escribe, lista en la cabecera de la migración **todos** los
  escritores de la columna que toca (edges, RPCs, otros triggers). Al orquestar pasos en una edge sobre
  tablas con triggers, **enlaza/estampa antes de disparar** el trigger que compite por el mismo campo.
- **Caso real (BP1):** `sql/2026-09-14-bp1-asegurar-conductor-normalizado.sql` declara el inventario de
  escritores de `conductores.usuario_id` (edge `conductor-crear-acceso`, trigger AI9,
  `z2-z3-conductor-fixes.sql:53`, `asegurar_mi_conductor()`) y la edge se reordenó para **enlazar antes
  de asignar el rol**.

## 14. Un gate por rol vive en UN predicado del servidor, y toda pantalla/RPC/edge lo llama (BQ)
Un permiso "quién puede" (flota elevada, tecnología, gestionar incentivos, gestionar proyectos…) se
define **una sola vez** como predicado del servidor (`es_flota_elevado()`, `es_tecnologia()`,
`puede_gestionar_incentivos()`, `puede_gestionar_proyectos()`…). **Cada** pantalla, RPC hermano y edge
que decida quién puede lo **llama** — nunca copia la lista de roles ni deja un `is_admin()` "mientras
tanto". Corolario: cuando el servidor **fusiona o retira una identidad** (un usuario, un conductor, una
bodega), la migración nace con el **plan de reintento** de los payloads que los clientes offline ya
encolaron contra la identidad vieja.

- **Por qué:** un mismo permiso duplicado en N sitios se desincroniza. BO4 movió el gate de combustible a
  `es_flota_elevado()` pero `echadas_sospechosas()`/`sanear_echada()` seguían en `is_admin()` (BQ3) → el
  panel de Saneamiento negaba a Logística lo que el RPC hermano ya le permitía; y el `is_admin()` sin JWT
  lanzaba un 42501 que el friendly-error pintaba como error del sistema. El corolario: BP1 borró el
  conductor "fantasma" de Felix, pero su teléfono traía el id cacheado y reintentaba (23503) — el fix
  (BQ7) fue que el RPC **ignore el `conductor_id` del cliente y lo resuelva por `auth.uid()`**, así el
  payload huérfano pasa al reintentar sin tocar el teléfono.
- **Regla:** al tocar un gate por rol, `grep` el predicado y alinéa **todos** los llamadores (pantalla +
  RPC + edge). Si el gate es de servidor, el botón se pinta con el **mismo** predicado (regla 3.5): si el
  rol puede, ve el botón. Al fusionar/retirar una identidad, incluye en la migración cómo reintenta el
  cliente offline (resolver por `auth.uid()`, `on conflict do nothing`, reapuntar FKs).
- **Casos reales (BQ):** `sql/2026-09-14-bq3-bq5-saneamiento.sql` (is_admin→`es_flota_elevado()` en los
  dos RPCs hermanos + grants), `sql/2026-09-14-bq7-combustible-conductor-por-uid.sql` (resuelve conductor
  por `auth.uid()`, ignora el id huérfano con `raise notice`), `sql/2026-09-14-bq2-destinatarios-notificacion.sql`
  (predicado único `destinatarios_notificacion` que las 6 edges de correo llaman en vez de copiar la
  lista por módulo).

## 15. El servidor no le impide a un usuario registrar lo que hizo (BR1/BQ7/BO5)

- **Por qué:** un chofer echó gasolina **de verdad** y el sistema **rechazaba el dato** porque otro no
  registró antes (salto de km irreal) o porque una tabla de asignación no lo listaba (AF18). El rechazo
  duro debe quedar solo para lo **físicamente imposible** (galones > capacidad del tanque, precio fuera de
  banda) — y aun esos, un rol elevado los **confirma**.
- **Regla:** el servidor **acepta** el dato con una **bandera** (`km_alerta`, `sin_asignacion`) y **avisa
  a quien puede resolverlo** (Logística), en vez de lanzar una excepción. El mensaje al usuario **dice
  quién** puede ayudarle. Corolario cliente: un dato rechazado por negocio siempre ofrece **"Descartar"** y
  **"Avisar a quien puede"** — nunca se queda en cola para siempre.
- **Casos reales (BR):** `sql/2026-09-15-br1-combustible-acepta-y-avisa.sql` (AF18 une `vehiculo_usos` y ya
  no rechaza → `sin_asignacion` + aviso; el salto de km acepta a todos con `km_alerta`; `km_base_combustible`
  editable por admin; cron `sgc-vehiculos-sin-echada` que avisa proactivamente),
  `sql/2026-09-15-br4-recepcion-rechazar.sql` (rechazar una recepción con motivo + aviso al emisor, sin
  mover stock).

## 16. Lo que el usuario ve lo decide su ROL, no el estado del sistema (BS1/BS2)

- **Por qué:** a Raykler (almacén) le salía **"Tabla de vehículos no configurada — ejecuta el SQL en el SQL
  Editor de Supabase"** (BS2, #37). Él no es desarrollador ni administra la base: ese texto no es para él. Y
  en una requisición solo le dejaban ver **un** almacén (BS1, #36), escondiendo opciones válidas por
  conveniencia.
- **Regla:** un **error técnico nunca le habla al usuario en lenguaje de desarrollador** — se **traduce**
  (mensaje humano por rol), se **reporta a Tecnología** con el detalle (ruta, rol, SQLSTATE, mensaje), y el
  **detalle técnico solo lo ve `es_desarrollador()`**. Fuente única en el front: `friendly-error.util.presentarError`
  + `shared/ui/error-state`; guard de build `scripts/verify-dev-strings.mjs` (rompe el build si aparece jerga
  de BD/infra en un template fuera de `pages/tecnologia|admin`).
- **Corolario:** un **selector nunca esconde opciones válidas por conveniencia** — la conveniencia es el
  **preseleccionado**, no el **filtro**. (BS1: el almacén de despacho ofrece todos los que el rol lee, con
  Central preseleccionado; `inventario/requisiciones`.)
- **Corolario de acceso:** si una cuenta ve una pantalla que no debería, se arregla **del lado que
  corresponda** (regla 4/14): guard = RLS. DEFAULT si es ambiguo: **no se abre la RLS** (se cierra el guard).
  En BS2 la RLS ya concedía Flota a Raykler (módulo `flota` por 3 roles) → el bug era el banner, no el acceso.
- **Casos reales (BS):** `friendly-error.util.ts` (`presentarError`), `shared/ui/error-state`,
  `scripts/verify-dev-strings.mjs`; `inventario/requisiciones` (picker de almacén con cobertura n/N).

## 17. La unidad de i18n es la PANTALLA, no la clave — y toda captura con fotos guarda borrador (BT2/BT4)

- **Por qué:** la convención "la clave de traducción ES el texto en español" hace que **todo lo no cableado
  con `t()` se vea "bien" en español** y nadie lo note en build (`verify-i18n` solo avisa por claves usadas sin
  `en`; lo no cableado ni siquiera es clave). El usuario elige "English" y ve media pantalla en español (BT2,
  #41). **Un cambio de idioma que deja la mitad en el idioma anterior es un bug, no un "rollout incremental".**
- **Regla:** un idioma se **ofrece completo** en el selector **solo cuando cubre todas las pantallas del
  alcance** (guard `scripts/i18n-coverage.mjs` en prebuild, mide por pantalla; alcance en
  `src/app/core/i18n/alcance.json`, nombres propios en `scripts/i18n-whitelist.json`). Mientras no llegue al
  umbral (95 % `en`, 90 % `ht`), el selector lo marca **beta** (con la cobertura real) o **próximamente**
  (deshabilitado) — **nunca lo ofrece a medias**. Una pantalla marcada `enforce:true` rompe el build si tiene
  literales sin `t()`. El script y el `alcance.json` se **comparten con la app** (padre → hijo).
- **Corolario (BT4/BT5):** **toda captura con fotos guarda borrador local desde la primera tecla** — la app
  puede morir (memoria, cámara, cierre por el sistema) y el usuario recupera exactamente donde iba (banner
  "Tienes un borrador sin enviar"). Nada que el usuario escribió se pierde por un cierre.
- **Casos reales (BT):** `scripts/i18n-coverage.mjs`, `docs/I18N-COVERAGE.md`, `src/app/core/i18n/alcance.json`,
  `shared/ui/language-selector`/`language-onboarding` (badges beta/próximamente); borradores de captura en
  `csd-app` (`conduce-externo`, PROMPT-57).
