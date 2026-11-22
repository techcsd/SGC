# Release 1.220.0 (modo degradado de conduces con Odoo caído, PROMPT-151 DU)
- Equipo/tester: Claude Code (sesión asistida); sin prueba humana en navegador y SIN prueba en vivo contra Odoo real (el Odoo de staging devolvía HTTP 502; dev no tiene almacenes con fuente Odoo)
- Qué se probó: 3 tests Deno nuevos (Odoo caído + sondeo reciente → emite en modo sgc, avisa y registra; Odoo caído + sondeo viejo/apagado → bloquea; «sin stock» nunca se degrada) y la suite completa (474) verde; build con todos los guards; migración `2026-11-22-du-conduce-degradado.sql` aplicada en dev y prod; smoke en dev con transacción revertida (umbral alto → permitido, apagado → bloquea, registro idempotente, aviso a 3 destinatarios); edge `odoo-api` desplegada en dev y prod; en prod `odoo_degradado_permitido()` responde y devuelve permitido con sondeo de 0.01 h.
- NO probado: emitir un conduce real en un almacén con fuente Odoo con Odoo caído (extremo a extremo); el aviso ámbar en la pantalla de conduces; el aviso a Tecnología en la campana de un usuario.
- Versión de origen: 1.219.0
- OK: Xaviel autorizó en el chat 2026-11-22 («si, haz todo», en respuesta a: ¿Apruebo el diseño de modo degradado? umbral propuesto 2 h)
- Resultado: OK (autorizado por Xaviel) · pendiente prueba humana
- Fecha: 2026-11-22
- [x] Tests Deno de los tres caminos (degradado, bloqueo, sin stock)
- [x] Smoke SQL en dev (revertido) de permitido / apagado / registro idempotente / aviso
- [ ] Conduce real con Odoo caído en un almacén con fuente Odoo (no probado)
Probado por: Claude Code (sesión asistida, sin prueba humana) · 2026-11-22
