# Release 1.220.1 (hotfix: tareas sin obra obligatoria + mensajes con adjunto desde el conector, PROMPT-151 DU)
- Equipo/tester: Claude Code (sesión asistida); sin prueba humana. No se probó de punta a punta desde un cliente real de Claude Desktop (no hay uno conectado en esta sesión).
- Qué se probó: 480 tests Deno (6 nuevos del adjunto: tipo permitido, base64 inválido, límite 3 MB, nombre seguro) y build con todos los guards (evals de Compa, cobertura del conector, grants de RPC); migración `2026-11-22-du-tareas-sin-obra-mensaje-adjunto.sql` aplicada en dev y prod; smoke en dev con transacción revertida: `asignar_tarea` sin obra crea la tarea, `enviar_mensaje_directo_adjunto` guarda el adjunto, rechaza una ruta de otra conversación y rechaza una tarea sin asignado; el bucket `sgc-mensajes` ahora admite csv y txt (se conservaron los tipos de audio); edges `mcp`, `claude-borrador` y `assistant` desplegadas en dev y prod.
- NO probado: crear una tarea sin obra desde el conector real; enviar un mensaje con adjunto desde el conector real y verlo en el chat del destinatario; la tarjeta del borrador con la línea de adjunto.
- Versión de origen: 1.220.0
- OK: Xaviel autorizó en el chat 2026-11-22 («envialo a prod como hotfix, estas autorizado»)
- Resultado: OK (autorizado por Xaviel) · pendiente prueba humana
- Fecha: 2026-11-22
- [x] Tests Deno del adjunto y suite completa (480)
- [x] Smoke SQL en dev (revertido) de asignar_tarea y enviar_mensaje_directo_adjunto
- [ ] Tarea sin obra y mensaje con adjunto desde Claude Desktop real (no probado)
Probado por: Claude Code (sesión asistida, sin prueba humana) · 2026-11-22
