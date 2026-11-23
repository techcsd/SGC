# Release 1.221.0 (ronda DX: IA con errores claros, correos trazables, Pulso resiliente, QR por tipo, adjuntos en reportes, import de personal)
- Equipo/tester: Claude Code (sesión asistida) con usuarios QA de dev y llamadas reales a las edges de dev.
- Qué cambia: helper de IA con timeout/errores tipados (Compa, Resumir); notificar-solicitud traza fallos y reintenta; Pulso del sistema por bloques + 3 filas nuevas; QR por tipo de documento (requisición, apagado); documentos en reportes (PDF/Word/Excel/CSV/TXT); importación de personal (obra/cargo); oficina de agentes solo admin; etiqueta del historial de versiones; contador de motivo al rechazar requisición.
- Qué se probó: build, prebuild completo, 399 tests unitarios, 496 tests Deno. En dev: Compa y Resumir responden; Pulso con 250 mil filas simuladas (101 ms); QR requisición apagado→409, sin acceso→403, válido→ruta, alterado→400; adjuntos: válidos suben, .exe/10 MB/6.º rechazados por el servidor; agentes: admin ve 7, Tecnología sin admin ve 0.
- NO probado: pantalla en navegador (Playwright), etiqueta del historial en en/ht con capturas, importación con el Excel real de Yonairy, lectura real del docx dentro de un resumen, envío de correo real (Resend dev sin cuota), prueba manual de Xaviel en dev.
- Versión de origen: 1.220.3
- Resultado: OK
- Fecha: 2026-11-23
**OK de Xaviel** 2026-11-23: «A, B, C y D, sigue con lo pendiente en dev. haz todo» (migraciones y edges ya aplicadas a prod; merge a main autorizado)
- [x] Build y tests
- [x] Pruebas de dev por API con usuarios QA
Probado por: Claude Code (sesión asistida) · 2026-11-23
