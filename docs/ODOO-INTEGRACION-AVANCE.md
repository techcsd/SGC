# Avance — Integración SGC ↔ Odoo (ronda DS, 16-nov-2026)

Documento reanudable: se actualiza al terminar cada ítem. Rama de trabajo: `feature/ds-odoo-ronda-16nov` (worktree `SGC-ds`, desde `origin/main`).
Regla de seguridad (repo público): sin hosts, usuarios, claves, ids de proyecto Supabase ni UUIDs en este archivo.

## Estado por fase

| Fase | Ítems | Estado |
|---|---|---|
| F0 Verificar | DS-01, DS-31 | Parcial: worktree creado, docs de Miranda integrados (cherry-pick `d2ea987d`), grafo actualizado, issues #2–#24 en `docs/ODOO-ISSUES-ESTADO.md` (en curso) |
| F1 Staging conectado | DS-02 ✅ · DS-03 ⏳ · DS-04 ⏳ | DS-02 hecho (commit `0bf8931e`). DS-03/DS-04 bloqueados: falta el nombre de la base y el usuario de Odoo staging en `.env.local` |
| F2 Homologación | DS-05…DS-08 | Pendiente |
| F3 Traslados A/B | DS-09…DS-12 | Pendiente |
| F4 Sombra/conciliador | DS-13, DS-14 | Pendiente |
| F5 Circuito 2 | DS-15…DS-23 | Pendiente |
| F6 Compras/proveedores | DS-24…DS-26 | Pendiente |
| F7 Fases 3–6 (apagadas) | DS-27…DS-30 | Pendiente |
| F8 Issues no-Odoo | DS-32…DS-47 | Pendiente |
| F9 Cierre | — | Pendiente |

## Hechos

- **DS-02** — `verificarHostEscritura()` en `_shared/odoo-client.ts`: toda escritura exige que el host de `ODOO_URL` esté en `ODOO_HOSTS_ESCRITURA` (sin la variable, no se escribe a ningún host); si el host está en `ODOO_HOSTS_PROD`, exige además `ODOO_PERMITIR_PROD=true`. Lecturas no se afectan. 5 tests nuevos (`odoo-host-guard.test.ts`); suite Deno completa 321/321. Los tests existentes que escriben contra un host simulado ahora inyectan `entorno`.

## Hallazgos de F0

- `origin/main` avanzó durante la ronda (`3cce1ef9` → `d1d17146`); el worktree parte de `d1d17146`.
- `origin/feature/odoo-schema-handoff` (1 commit): los archivos que trae ya están en `main` (`docs/odoo-schema/`, `sql/2026101611252*`); no aporta nada nuevo.
- `.env.local` del checkout principal contiene solo `SGC_INTEGRATION_ODOO_API_KEY` entre las variables `ODOO*`/`SGC_INTEGRATION*`. Faltan URL, base de datos y usuario (ver Bloqueos).
- `.gitignore` cubre `.env.local` (`*.local`), `*.env` y `*api_key*`.
- El servidor de staging responde (Odoo 17.0+e); la lista de bases está deshabilitada, así que el nombre de la base no se puede descubrir.

## Bloqueos (físicos, de Xaviel)

1. Nombre de la **base de datos** de Odoo staging y **usuario/login** de la cuenta dueña de la clave. Añadir a `.env.local` (gitignored): `SGC_INTEGRATION_ODOO_DB=…`, `SGC_INTEGRATION_ODOO_USER=…`, `SGC_INTEGRATION_ODOO_URL=https://…`. La base se ve en la pantalla de login de Odoo o en el selector de bases; si no, pedírsela a Chai.

## Pendiente inmediato

DS-03 (verificación de contrato contra staging), cambio de secrets de dev a staging (reportando antes el host actual), y F2 en adelante. Esta ronda no cabe en una sola sesión: ver número exacto de ítems pendientes en el reporte final.
