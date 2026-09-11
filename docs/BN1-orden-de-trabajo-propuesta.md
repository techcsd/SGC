# BN1 — Orden de trabajo: propuesta de diseño

**Estado:** propuesta para revisión de Xaviel. **No construir hasta OK.** Construir **antes que BN2**
(la tabla de firmas de aquí es la que BN2 reutiliza).

Un nuevo `tipo` de `sgc.bitacoras` = `'orden_trabajo'`: el ingeniero levanta en obra un trabajo
solicitado por el cliente, con descripción/ubicación/monto estimado, y **dos firmas** (ingeniero +
cliente) capturadas en el mismo dispositivo, con PDF descargable.

---

## 0. Corrección a la premisa del prompt (§G-1 está casi resuelto)

El prompt (FASE 6.2 / §G-1) afirma que `sgc.bitacoras` tiene **SEIS** columnas `NOT NULL` sin
default que una orden de trabajo no tiene, y plantea el dilema *nullables-condicionados-por-tipo* vs
*centinelas*. **Verificado contra prod (09/09/2026) — la premisa ya no aplica:**

| Columna (prompt) | Estado real en prod | Fuente |
|---|---|---|
| `bloque_entrepiso` | **YA nullable** | `2026-07-07-bitacora-tipos.sql:14` (`drop not null`) |
| `ingeniero_responsable` | **YA nullable** | `…:15` |
| `hora_fin_trabajo` | **YA nullable** | `…:16` |
| `personal_carpinteria` | NOT NULL **DEFAULT 0** | migración original |
| `personal_acero` | NOT NULL **DEFAULT 0** | migración original |
| `trabajadores_casa` | NOT NULL **DEFAULT 0** | migración original |

La **misma** migración que introdujo `tipo` (5 días después del nacimiento de la tabla) ya relajó las
tres primeras. Las tres restantes son NOT NULL **pero con `DEFAULT 0`**, así que un `INSERT` que las
**omita** no revienta (regla 1 del checklist: un default sólo se anula con un `null` explícito).

**Las únicas columnas `NOT NULL` sin default son `usuario_id`, `proyecto_id`, `fecha`** — que una
orden de trabajo tiene de forma natural.

### Recomendación §G-1
**Ninguna de las dos salidas del prompt hace falta.** No se tocan NOT NULL ni se inventan centinelas:
el RPC de la orden simplemente **omite** las columnas del parte diario; los tres contadores caen a `0`
por su default (semánticamente correcto: una orden de trabajo no cuenta cuadrillas). Y como todos los
KPI filtran `tipo = 'parte_diario'` (`kpi-proyectos.sql:38,41`;
`ad-proyectos-prueba-aislamiento.sql:35,38`), los `0` de la orden **no contaminan** ninguna métrica.
→ **Decisión que queda para ti:** confirmar este camino (recomendado) en vez de nullables/centinelas.

---

## 1. Dominio de `tipo` (CHECK sin nombre)

`tipo` es un `CHECK (tipo in ('parte_diario','visita','incidente'))` sin nombre, en un solo sitio
(`2026-07-07-bitacora-tipos.sql:9-11`). No hay enum ni tabla-catálogo de tipos.

**Patrón de extensión** (drop + add **con nombre explícito**, como `act3-s12s13-incidentes.sql:10-12`):

```sql
alter table sgc.bitacoras drop constraint if exists bitacoras_tipo_check;
alter table sgc.bitacoras add constraint bitacoras_tipo_check
  check (tipo in ('parte_diario','visita','incidente','orden_trabajo'));
```

Aditivo (regla 3 del checklist: ampliar la lista nunca viola filas existentes). ⚠️ **Trampa evitada:**
`sgc.bitacora_catalogos` NO es el catálogo de tipos de entrada (enumera vocabularios de campo).

---

## 2. Tablas

### 2.1 Cabecera — reutiliza `sgc.bitacoras`
La orden ES una bitácora `tipo='orden_trabajo'`. Reusa `id`, `usuario_id`, `proyecto_id`, `fecha`,
`es_prueba`, `created_at`. Campos propios de la orden → **tabla hija** (no ensuciar `bitacoras` con
columnas de un solo tipo).

### 2.2 Detalle de la orden — `sgc.bitacora_orden_detalle`
```sql
create table if not exists sgc.bitacora_orden_detalle (
  id           uuid primary key default gen_random_uuid(),
  bitacora_id  uuid not null references sgc.bitacoras(id) on delete cascade,
  descripcion  text not null,                 -- qué trabajo se hizo/pidió
  ubicacion    text,                          -- dónde dentro de la obra (torre/piso/área)
  cantidad     numeric,                       -- opcional
  unidad       text,                          -- m², qq, ud… (datalist existente)
  monto_estimado numeric,                     -- ⚠️ §G-2: sólo registro, NO factura
  solicitado_por text,                        -- nombre del lado del cliente que lo pidió
  notas        text,
  es_prueba    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (bitacora_id)                         -- 1 detalle por orden (o quitar el unique si multi-renglón)
);
```
> **Decisión menor:** ¿un renglón por orden, o varios (tabla de líneas)? Propongo **uno** para v1
> (una orden = un trabajo). Si se quiere multi-renglón, quitar el `unique` y la UI itera.

### 2.3 Firmas — `sgc.bitacora_orden_firmas` (molde exacto de `salida_firmas`)
Molde probado: `sgc.salida_firmas` (`ac7-conduce-firmas.sql:17-30`). Los campos de texto libre
`nombre`/`cedula`/`rol_desc` son **precisamente** el caso del cliente sin cuenta en el sistema.
```sql
create table if not exists sgc.bitacora_orden_firmas (
  id           uuid primary key default gen_random_uuid(),
  bitacora_id  uuid not null references sgc.bitacoras(id) on delete cascade,
  rol          text not null check (rol in ('ingeniero','cliente')),
  nombre       text not null,                 -- se estampa en el PDF
  cedula       text,                          -- opcional (cliente puede no darla)
  rol_desc     text,                          -- "Ing. residente", "Propietario", etc.
  usuario_id   uuid references sgc.usuarios(id),  -- sólo el ingeniero lo tendrá
  firma_path   text not null,                 -- PNG en bucket privado
  metodo       text not null check (metodo in ('pad','foto')),
  firmado_en   timestamptz not null default now(),
  unique (bitacora_id, rol)                    -- una firma por rol
);
```
Precedente de 4 roles si algún día hace falta: `sgc.cl_registro_firmas` (`q5-firmas-cl.sql:19-26`).

### 2.4 Fotos (opcional)
Reusar el patrón de fotos de bitácora existente (mismo bucket `sgc-bitacora`). No hace falta tabla
nueva si se cuelga del mecanismo de fotos que ya usa la bitácora.

---

## 3. Bucket de firmas — `sgc-bitacora` (ya declarado, cumple BM2/BI1)

Verificado en prod: candidatos privados disponibles —
- **`sgc-bitacora`** · 15 MB · sin restricción MIME → **RECOMENDADO**. La orden ES una bitácora; sus
  firmas viven en el bucket del registro padre, que **ya está declarado en `sql/`** y **ya tiene
  políticas INSERT+UPDATE** (BI1, tras el fix de las bitácoras atascadas de Jonathan Roman). Cero
  bucket nuevo que declarar.
- `obra` · 15 MB (evidencia de campo) — alternativa si se prefiere separar firmas de fotos.
- `sgc-legal` · 25 MB · permite pdf/png/docx — sólo si la orden se considera **instrumento legal**;
  buen destino para el **PDF final** (ver §6).

Convención universal de firmas (sin excepciones): PNG del pad → bucket privado → `firma_path text` +
`metodo`. Ruta determinista tipo `orden/${bitacora_id}/${rol}-${crypto.randomUUID()}.png`
(patrón `salidas.service.ts:182-183`).

> ⚠️ Recordatorio BM2: si al final se elige un bucket **no declarado en `sql/`**, hay que declararlo
> (INSERT + INSERT/SELECT/UPDATE + `file_size_limit`) o el auditor de prebuild rompe el build. Con
> `sgc-bitacora` esto ya está resuelto.

---

## 4. RPC — propio para la orden (`SECURITY DEFINER`)

Los RPCs vivos (`crear_entrada_bitacora` 40 args web; `crear_bitacora_app` móvil, ambos en
`bc7-…grant.sql`) toleran un `p_tipo` arbitrario pero **ramifican sólo para `parte_diario`** y un
tipo nuevo cae por el `else` **sin hijos ni validación**. Como la orden tiene **detalle + dos firmas**,
la recomendación es un **RPC propio**, no extender los de 40 args.

```
sgc.crear_orden_trabajo(
  p_proyecto_id, p_fecha, p_descripcion, p_ubicacion, p_cantidad, p_unidad,
  p_monto_estimado, p_solicitado_por, p_notas,
  p_firma_ing  jsonb,   -- {nombre, cedula, rol_desc, firma_path, metodo}
  p_firma_cli  jsonb,   -- idem
  p_es_prueba  boolean
) returns uuid   -- el bitacora_id
```

🔴 **Regla de servidor (no sólo del form):** una orden **NO se crea sin las dos firmas**. El RPC
rechaza si falta `p_firma_ing` o `p_firma_cli` (salvo admin, como
`ay2-recepcion-unify-firma.sql:58` / `bd2b-…:56` rechazan sin `p_firma_path`). Inserta cabecera +
detalle + las dos filas de firma en una transacción. `SECURITY DEFINER` + `grant … to authenticated`
(reglas 5 y 5-ter del checklist).

---

## 5. RLS del tipo nuevo (regla 1 del checklist)

Quién **crea** y quién **ve** una orden de trabajo NO es lo mismo que un parte diario. Revisar:
- `aw3-aw5-jefe-ingenieros-bitacoras-ver-todas.sql` (visibilidad ampliada por permiso).
- `aq8-bitacoras-por-rol-obra.sql` (ve por responsabilidad de obra).

**Propuesta:** crea el ingeniero responsable de la obra (o rol con módulo `bitacora`); ven el autor,
los responsables de esa obra, y `bitacora.ver_todas`. Las tablas hijas
(`bitacora_orden_detalle`/`_firmas`) heredan la visibilidad vía el `bitacora_id` (política que valida
acceso a la bitácora padre). ⚠️ **Regla 4/BH1:** el botón "Nueva orden de trabajo" **sólo se pinta**
a quien el RPC va a dejar crear — espejar la condición del servidor en el front. Smoke desde la cuenta
que sufre el caso (el ingeniero de campo), no sólo admin.

---

## 6. PDF de la orden (con las dos firmas)

El patrón existe en la app: `csd-app/.../conduce-pdf.service.ts:170-185` recorre `firmas.slice(0,2)`
y dibuja cada `firma_url` (URL firmada derivada del `firma_path`). Dos opciones:
- **Cliente** (como el carnet): rápido, pero hoy **no hay generación de PDF en cliente en el producto**
  (§G-4 sin decidir). No introducir una librería nueva sólo por esto.
- **Servidor** (recomendado, coherente con el resto): edge function con `pdf-lib`, reutilizando el
  `buildPdf()` genérico de `resumen-semanal-operaciones/index.ts:54-87` **si se extrae a compartido**
  (misma decisión §G-7 que BN5b). Encabezado con logo, obra, fecha, descripción, monto estimado, y
  **las dos firmas estampadas**. Destino sugerido del PDF: `sgc-legal` (permite pdf, 25 MB) si la orden
  es instrumento; si no, `sgc-bitacora`.

⚠️ **§G-2:** no hay módulo de facturación (`mejoras-proyectos.sql:4-5`). El `monto_estimado` queda
**registrado y exportable** (Excel/PDF); **no** se promete integración con una factura inexistente ni
se construye un módulo de cobros.

---

## 7. Front web — sitios que enumeran `tipo` (todos hay que tocarlos)

- **Modelo:** `shared/models/bitacora.model.ts:100` (unión `BitacoraTipo`), `:102-106`
  (`BITACORA_TIPOS`, lista canónica del selector), `:146`, `:202`.
- **Alta:** `pages/bitacora/nueva/nueva.ts` (:115, gateo :314-318, :374, :552, :886, :911, :925,
  :999-1008, :1026) + `nueva.html:191,227,352`. La orden necesita su **propia sección de formulario**
  (descripción/ubicación/monto/solicitado_por) + **dos `<app-signature-pad>`**.
- **Historial:** `historial.ts:467` (`tipoLabel`), `:470-474` (`tipoBadgeClass`), `:518-519`, `:551`
  (export) + `historial.html:157-165,325,348,410`.
- **Dashboard:** `dashboard.ts:58-59,90,109,129` + `dashboard.html:32-33`.

**Pad de firma:** `shared/ui/signature-pad/signature-pad.ts` (92 líneas, 0 deps, `toBlob()`→PNG,
`isEmpty()`, `clear()`). Montarlo **dos veces** con `viewChild('firmaIng')` / `viewChild('firmaCli')`
(patrón `entregas.ts:49` + `checklists.ts:47,60,120`). Cada firma: capturar PNG → subir a
`sgc-bitacora` → pasar `firma_path`+`metodo` al RPC.

---

## 8. Orden de construcción (tras tu OK)

1. **Migración:** CHECK `+'orden_trabajo'` (con nombre) · `bitacora_orden_detalle` · `bitacora_orden_firmas`
   · RLS de ambas hijas · grants. (Sin tocar NOT NULL — §G-1 recomendación.)
2. **RPC** `crear_orden_trabajo` con validación de las **dos firmas** en servidor.
3. **Front web:** nuevo `tipo` en modelo/selector/historial/dashboard + sección de formulario + dos pads.
4. **PDF** con las dos firmas (servidor, reusando `buildPdf` si §G-7 aprueba la extracción).
5. **Paridad app** (`PROMPT-43`).
6. **BN2 después** (reutiliza `bitacora_orden_firmas`).

---

## Decisiones que necesito de ti antes de construir

- **§G-1:** confirmar el camino recomendado (omitir columnas del parte diario; contadores a 0 por
  default; sin nullables ni centinelas). **La premisa de "6 NOT NULL" ya no aplica en prod.**
- **§G-2:** confirmar que `monto_estimado` es sólo registro/exportable (sin facturación).
- **Detalle:** ¿orden = un renglón (propuesto) o multi-renglón?
- **Bucket:** ¿firmas en `sgc-bitacora` (recomendado) u `obra`? ¿PDF final en `sgc-legal` u `obra`?
- **§G-4 / §G-7:** ¿PDF en servidor reutilizando `buildPdf` extraído a `_shared/`? (comparte decisión con BN5b)
