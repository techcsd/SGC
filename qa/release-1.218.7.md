# Release 1.218.7 (alerta de sondeo de Odoo caído, PROMPT-151 DU5)
- Equipo/tester: Claude Code (sesión asistida); sin prueba humana en navegador
- Qué se probó: migración `sql/2026-11-22-du-alerta-sondeo-odoo-caido.sql` aplicada en dev (ledger) y luego en prod (ledger); smoke en dev con transacción revertida: 6 sondeos fallidos simulados → 1 aviso a Tecnología (3 destinatarios) y la segunda llamada no repite; en prod la función devuelve 0 avisos (sondeo sano). En dev avisó con datos reales (Odoo de staging devolvía HTTP 502). Release de un solo archivo SQL, sin cambios de frontend.
- NO probado: la notificación vista en la campana de un usuario de Tecnología en prod (no hay caída que la dispare).
- Versión de origen: 1.218.6
- OK: Xaviel autorizó en el chat llevar esto a main 2026-11-22
- Resultado: OK (autorizado por Xaviel) · pendiente prueba humana
- Fecha: 2026-11-22
- [x] Smoke en dev (transacción revertida): 6 sondeos fallidos simulados → 1 aviso a Tecnología; segunda llamada sin repetir
- [x] Función en prod devuelve 0 avisos con sondeo sano
- [ ] Notificación vista en la campana de un usuario de Tecnología (no probado)
Probado por: Claude Code (sesión asistida, sin prueba humana) · 2026-11-22
