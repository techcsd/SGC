# Release 1.220.2 (hotfix: adjunto de mensajes del conector llega como texto JSON)
- Equipo/tester: Claude Code (sesión asistida) con el Chrome de Xaviel logueado en sgcconstructorasd.com (producción).
- Qué se probó: 481 tests Deno (nuevo: el adjunto como texto JSON se acepta igual que como objeto); edges `claude-borrador` y `mcp` desplegadas en dev y prod. En producción, de punta a punta: se preparó un mensaje con adjunto desde el conector, la tarjeta mostró «Adjunto: conduces-atascados-18nov.csv», se confirmó, y en la base quedó el mensaje con `archivo_nombre`, `archivo_mime=text/csv` y `archivo_size=5411`, el archivo existe en `sgc-mensajes/<conversación>/…`, y el destinatario (Raykler) es participante de la conversación. También se creó en producción una tarea sin obra (proyecto_id nulo) para Raykler.
- Hallazgo: el cliente de Claude Desktop mandó `adjunto` como texto JSON (su esquema local aún es el anterior a 1.220.1); el servidor ahora acepta ambas formas.
- NO probado: que Raykler abra/descargue el archivo desde su chat; el envío desde un cliente con el esquema ya actualizado.
- Versión de origen: 1.220.1
- OK: Xaviel autorizó en el chat 2026-11-22 («envialo a prod como hotfix, estas autorizado»; luego «hazlo tu por favor» para confirmar los borradores)
- Resultado: OK (autorizado por Xaviel) · pendiente prueba humana
- Fecha: 2026-11-22
- [x] Tests Deno (481)
- [x] Mensaje con adjunto confirmado en producción: fila, archivo en el bucket y participantes verificados en la base
- [x] Tarea sin obra creada en producción
- [ ] Raykler abre el archivo desde su chat (no probado)
Probado por: Claude Code (sesión asistida, sin prueba humana) · 2026-11-22
