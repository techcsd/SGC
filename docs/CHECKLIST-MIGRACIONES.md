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

## 3. Grants de schema y secuencias
Al crear tabla/función/secuencia en `sgc`, verificar `grant` a `authenticated`/`service_role`
según corresponda (bugs históricos: `permission denied for schema sgc`,
`permission denied for sequence roles_id_seq`).

## 4. RPCs de escritura para roles no-admin → `SECURITY DEFINER`
Gemelo del gate de módulo. La guarda `verify-regresiones.mjs` exige `security definer`
en RPCs marcados y detecta el cierre `$function$`.

## 5. Aditivo y retrocompatible
`add column if not exists`, `create ... if not exists`, `create or replace`. Nunca romper
un contrato que la app (csd-app) ya consume — **paridad web↔app**.
