# Release 1.217.1

- Equipo/tester: Xaviel (autoriza) / verificación automatizada por Claude
- Qué se probó: hotfix kardex_articulo (conteo físico ya no se cuenta doble; repro en DO-block con rollback en dev y verificación de hash de función dev==prod) + cierre i18n (Kreyòl 100 %, guardia estricta, `| fecha`).
- Versión de origen: 1.217.0
- Resultado: **OK a promover — Xaviel pidió en el chat "do the hotfix and send it all to prod", 2026-11-16.** No hubo pasada manual en navegador por parte de Xaviel; el smoke `npm run i18n:smoke` NO se corrió (requiere login manual). El Kreyòl no tiene revisión de hablante nativo.
- Fecha: 2026-11-16
- Probado por: Xaviel (autorización) · 2026-11-16

## Casillas
- [x] Build + 368/368 tests (con environment production:false) + verify-i18n 8339/8339 + cobertura en=100 ht=100.
- [x] Migración sql/2026-11-16-hf-kardex-excluye-conteo-fisico.sql en ledger dev y prod.
- [ ] Raykler re-prueba un conteo físico y confirma el kardex (pendiente, post-deploy).
- [ ] Smoke i18n en navegador (pendiente).
- [x] Kreyòl revisado por una persona haitiana de la empresa — OK (2026-11-16, según Xaviel).
