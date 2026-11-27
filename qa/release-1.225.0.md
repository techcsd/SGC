# Release 1.225.0 (agentes: espejo prod→dev, reglas de la app en el Guardián; costos/KPI de proyectos; correos de requisiciones)
- Equipo/tester: Claude Code (sesión asistida); lo de dev lo probaron las sesiones de SGC y de csd-app en dev.sgcconstructorasd.com.
- Qué cambia: PRs #294 (auto-prod encendido), #295 (despacho con repo completo), #296 (hotfix correos de requisiciones sin cuentas QA ni es_prueba), #297 (reglas propias del repo en el Guardián), #298 (espejo prod→dev + pausa), #299 (agente: error de plantillas traducido) y #300 (agente: error estándar con reintento en costos y KPI de proyectos).
- Qué se probó: build y pruebas unitarias en la rama integrada; SQL de #294–#298 ya aplicados en dev y en prod con ledger (solo `agentes-espejo-cron` pendiente en prod, se aplica con este release); en dev, el carril del agente abrió PRs con G1/G2 en verde.
- NO probado por Claude: el espejo prod→dev corriendo con secrets reales (la edge queda inerte en prod hasta cargar ESPEJO_DEV_*); las pantallas de costos/KPI en navegador.
- Versión de origen: 1.224.0
- Resultado: OK
- Fecha: 2026-11-27
**OK de Xaviel** 2026-11-27: «tienes mi OK. hazlo --yes» (release 1.225.0 a prod).
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-27
- Corrección en el release: `agente-ingeniero-espejo` no tenía entrada en config.toml (verify_jwt=true → el cron con x-sync-secret recibiría 401); se agregó verify_jwt=false (la edge valida el secreto) y se redesplegó en dev.
- Excepción anotada: `release-check` falla el check de evals de Compa (19/21: `dc5-wa-propuesta-enlace` pide aclaración en vez de llamar `proponer_tarea`; `dx12-odoo-stock-apagado`). Falla igual en 2 corridas, pero este release NO toca `assistant/` ni nada de Compa (diff vs main sin esos archivos): es comportamiento/datos de dev ya presentes en prod, no introducido aquí. Pendiente aparte: revisar esos 2 casos. El resto de checks (ledger, registro, build, tests web y Deno, CU2) en verde.
