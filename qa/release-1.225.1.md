# Release 1.225.1 (agentes: primera promoción real a prod; humo, health y registro corregidos)
- Equipo/tester: Claude Code (sesión asistida); probado de punta a punta con una tarea real del Ingeniero (dev → PR #311 a main → verificación de prod).
- Qué cambia: PRs #302/#303/#306/#307 (humo en dev: sin networkidle, bypass de Vercel, spec tomado de dev), #308/#309/#313/#314 (registro de la tarea: ya-en-main, sin merge_prod, en_dev antes de en_prod, cherry-pick vacío), #312 (health con bypass; el login de Vercel ya no cuenta como sano), #305 (evals de Compa dc5/dx12 vigentes) y #310 (cambio del agente: línea de verificación en docs).
- Qué se probó: la promoción real del PR #310 (PR #311 a main, merge, health de prod OK, sin reversión); health de dev sin bypass falla con mensaje claro y el de prod pasa; build y tests en la rama integrada.
- NO probado por Claude: la promoción de una tarea de csd-app (primera real pendiente); la reversión automática (no se disparó).
- Versión de origen: 1.225.0
- Resultado: OK
- Fecha: 2026-11-27
**OK de Xaviel** 2026-11-27: «dale haz todo» (release 1.225.1 a prod; antes: «crea el bypass de csd-app en Vercel y úsalo, haz todo lo pendiente»).
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-27
