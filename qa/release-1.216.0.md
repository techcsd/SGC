# Release 1.216.0

- Equipo/tester: Xaviel
- Qué se probó: PENDIENTE — módulo Inventario (35 pantallas) 100% traducido
  en Inglés y Kreyòl ayisyen (artículos, almacenes, conduces, salidas,
  entradas, requisiciones, retiros, activos fijos, conteos, bodegas, etc.).
- Versión de origen: 1.215.0
- Resultado: **PENDIENTE — falta la prueba de Xaviel en dev.sgcconstructorasd.com.**
- Fecha: 2026-11-15 (construcción) / pendiente (prueba y OK de Xaviel)
- Probado por: pendiente

## Casillas (marcar tras probar en dev.sgcconstructorasd.com)

- [ ] Configuración › Idioma: cambiar a Inglés — el selector queda en "English", `<html lang>` cambia.
- [ ] Inventario › Artículos, Almacenes, Conduces, Salidas, Entradas: en Inglés, sin texto suelto en español (filtros, tablas, drawers de crear/editar, toasts).
- [ ] Inventario › Requisiciones, Retiros, Activos fijos, Conteos y ajustes: en Inglés, mismo chequeo.
- [ ] Cambiar a Kreyòl ayisyen — repetir el mismo recorrido; la traducción debe leerse coherente (no es revisión lingüística nativa, solo que no rompa la pantalla ni deje español).
- [ ] Volver a Español — nada cambió para el uso normal en español (el idioma por defecto de la empresa).

## Pendiente antes de promover a prod

- Ninguna migración SQL ni edge function en esta ronda — solo frontend
  (plantillas Angular + `public/i18n/en.json` + `public/i18n/ht.json`).
- `public/i18n/ht.json` (Kreyòl) generado por Claude sin revisión de un
  hablante nativo — ver `docs/I18N-REVISAR-HT.md`. No bloquea el release,
  pero es trabajo pendiente documentado.
