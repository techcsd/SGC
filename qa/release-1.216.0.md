# Release 1.216.0

- Equipo/tester: Xaviel
- Qué se probó: módulo Inventario (35 pantallas) 100% traducido en Inglés y
  Kreyòl ayisyen (artículos, almacenes, conduces, salidas, entradas,
  requisiciones, retiros, activos fijos, conteos, bodegas, etc.).
- Versión de origen: 1.215.0
- Resultado: **OK — Xaviel probó en dev.sgcconstructorasd.com y autoriza
  continuar el pipeline dev → main (regla 18 / CP5).**
- Fecha: 2026-11-15 (construcción) / 2026-11-15 (prueba y OK de Xaviel)
- Probado por: Xaviel · 2026-11-15

## Casillas (marcar tras probar en dev.sgcconstructorasd.com)

- [x] Configuración › Idioma: cambiar a Inglés — el selector queda en "English", `<html lang>` cambia.
- [x] Inventario › Artículos, Almacenes, Conduces, Salidas, Entradas: en Inglés, sin texto suelto en español (filtros, tablas, drawers de crear/editar, toasts).
- [x] Inventario › Requisiciones, Retiros, Activos fijos, Conteos y ajustes: en Inglés, mismo chequeo.
- [x] Cambiar a Kreyòl ayisyen — repetir el mismo recorrido; la traducción debe leerse coherente (no es revisión lingüística nativa, solo que no rompa la pantalla ni deje español).
- [x] Volver a Español — nada cambió para el uso normal en español (el idioma por defecto de la empresa).

> Nota: OK dado por Xaviel en el chat de la sesión ("i tested it, mark it OK"), no una pasada casilla-por-casilla documentada en vivo — se registra aquí con el detalle que él confirmó.

## Pendiente antes de promover a prod

- Ninguna migración SQL ni edge function en esta ronda — solo frontend
  (plantillas Angular + `public/i18n/en.json` + `public/i18n/ht.json`).
- `public/i18n/ht.json` (Kreyòl) generado por Claude sin revisión de un
  hablante nativo — ver `docs/I18N-REVISAR-HT.md`. No bloquea el release,
  pero es trabajo pendiente documentado.
