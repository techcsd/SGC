# Checklist de migraciones SGC (reglas de nacimiento)

Toda migración fechada en `sql/` debe cumplir estas reglas antes de aplicarse a prod.
Dos de ellas están **automatizadas en `prebuild`** y **fallan el build** si se violan.

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
