# Evaluación y aplicación de la migración de IDs nativos de Odoo (CY3 + CY20)

> Migración: `sql/20261016112524_odoo_identity_fields.sql` (61 columnas nullable en 11 tablas + `sgc.odoo_instancias` + `sgc.odoo_companias` + 2 funciones de protección). Entregada en la rama `feature/odoo-schema-handoff` (commit `4d21fb64`, Alejandro Miranda, 16-oct-2026). Esta evaluación y aplicación es de **25-oct-2026, solo en dev**.

## Checksums verificados
`docs/odoo-schema/SHA256SUMS` coincide byte a byte con los archivos usados (`sql/20261016112524_odoo_identity_fields.sql`, `00_preflight.sql`, `01_verify_identity.sql`, `02_verify.sql`, `03_validate_constraints.sql`, `README.md`, `VALIDACION.md`, `qa/odoo-schema/*`). **No se instaló** `sql/20261016112525_odoo_sync_foundation.sql` (la ampliación con outbox/eventos) — por diseño de esta ronda (D-04): se coordina con #4/#6/#24 más adelante.

## Preflight contra el esquema vivo de dev (`00_preflight.sql`, solo lectura)
- Las 20 tablas verificadas tienen el tipo de `id` esperado por la migración (uuid salvo `categorias_inventario`/`unidades`, que son `integer`) — **0 discrepancias**.
- Únicas columnas `odoo_*` preexistentes: `odoo_ref` en `articulos`, `proveedores`, `vehiculos` (migración `cc4-odoo-ref`, anterior) — la nueva migración las deja intactas (no las toca, no las convierte).
- El grep de funciones con `SELECT *`/`INSERT sin columnas` que mencionan las tablas afectadas devolvió ~60 funciones, pero **ninguna** retorna `SELECT * FROM <tabla-extendida>` directamente — todas construyen `jsonb`/`TABLE(...)` con columnas explícitas o devuelven tipos escalares. Revisadas a ojo las firmas: no hay riesgo de que las 61 columnas nuevas se cuelen en una respuesta existente o rompan un `INSERT ... SELECT` sin lista.
- `service_role` tiene `USAGE` en `sgc` (esperado, sin cambios).

## Aplicación
```
node scripts/apply-migration.mjs sql/20261016112524_odoo_identity_fields.sql --env dev --dry-run   # OK
node scripts/apply-migration.mjs sql/20261016112524_odoo_identity_fields.sql --env dev             # aplicada + en el ledger de dev
node scripts/apply-migration.mjs docs/odoo-schema/03_validate_constraints.sql --env dev            # valida los 44 CHECK/FK "NOT VALID" -> validados
```

## Verificación posterior (`01_verify_identity.sql`)
- 2 tablas nuevas (`odoo_instancias`, `odoo_companias`): RLS activo, **0 acceso** para `anon`/`authenticated`, sin privilegios de backend excesivos.
- 11 tablas extendidas: 61 columnas nuevas repartidas (5–6 por tabla), **todas nullable y sin default** — confirmado por consulta, no solo por lectura del SQL.
- 2 funciones de protección (`odoo_v1_proteger_campos`, `odoo_v1_proteger_instancia`): no ejecutables por `anon`/`authenticated`, no `SECURITY DEFINER`.
- 44 constraints `odoo_v1_*` — **validados** tras correr `03_validate_constraints.sql` (antes de validar, estaban `NOT VALID` por diseño para no escanear en caliente; el repo ya está chico en dev así que no hubo riesgo de bloqueo largo).
- `sgc.odoo_instancias` vacía — ninguna conexión se crea sola, como se esperaba.

## Compatibilidad con la app (criterio 1 de CY20)
- `npm run build` y `npx ng test` (110/110) siguen verdes después de aplicar — la migración no toca ningún archivo de la app, es puramente aditiva en Postgres.
- PostgREST (`/rest/v1/<tabla>`) sigue respondiendo (401 por falta de sesión, **no 500/`PGRST`**) para las 7 tablas afectadas — confirma que el *schema cache* se recargó sin romper el contrato REST.
- **No se pudo correr una prueba interactiva en navegador esta ronda** (sin sesión abierta); la validación "altas/ediciones de artículo, proveedor, bodega, OC y líneas con perfiles reales" queda como **pendiente físico de Xaviel en `dev.sgcconstructorasd.com`** antes de considerar la promoción a prod — igual que ya advertía CONTEXTO-58 §3.2 para todo lo que depende de uso real.
- El runner de pruebas con clúster Postgres desechable del propio paquete (`qa/odoo-schema/run.sh`) **no se ejecutó** en esta máquina (no hay `initdb`/`psql`/`pg_ctl` instalados aquí) — se confió en la verificación contra el dev real (preflight + aplicación + verify + validate + PostgREST), que es una prueba más fuerte que el clúster desechable porque corre contra el esquema real, no una fixture.

## Decisión de promoción (D-04, sin cambios)
**No se promueve a prod en esta ronda.** Queda en `dev`, registrada en el ledger de dev únicamente. La promoción espera:
1. El contrato/matriz de `docs/ODOO-DIAGNOSTICO-CONTRATO.md` (CY18) aceptado por Xaviel.
2. Prueba manual de Xaviel en `dev.sgcconstructorasd.com` (altas/ediciones reales).
3. OK explícito por escrito de Xaviel.

## PR
Los archivos extraídos a `sql/`, `docs/odoo-schema/` y `qa/odoo-schema/` se integran directamente a `dev` en esta ronda (sin abrir un PR nuevo — ya estaban completos y verificados en `feature/odoo-schema-handoff`, que se mantiene como referencia histórica sin mergear).
