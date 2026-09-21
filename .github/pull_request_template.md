<!-- BU1 F7 — Plantilla de PR dev → main (main = PRODUCCIÓN). -->
## Qué cambia


## Checklist (regla 18 — nada llega a prod sin pasar por dev)
- [ ] Migraciones del PR aplicadas y en el **ledger de dev** (`apply-migration.mjs --env dev`) ✅
- [ ] Edges del PR desplegadas y en el **ledger de dev** (`deploy-edge.mjs --env dev`) ✅
- [ ] **Probado en `dev.sgcconstructorasd.com`** por __________ el __________ ✅
- [ ] Versión bumpeada + entrada en `release-notes.json` ✅
- [ ] Rollback anotado (cómo revertir) ✅
- [ ] ¿Algo va con `--force-prod`? Si sí, **motivo**: __________ (queda registrado en el ledger)

## Rollback
<!-- cómo revertir esta migración/edge/deploy si algo sale mal -->
