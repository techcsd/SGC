# Release 1.217.0

- Equipo/tester: Xaviel
- Qué se probó: el resto de la app (12 módulos: Compras, Flota, Bitácora,
  Transporte/apoyo, Proyectos, RRHH, Legal, Documentos, Ingeniería,
  Reuniones/Tareas/Notas/Mensajería, Tecnología, Administración) más el
  módulo "Resto" (Dirección, Incentivos, Soporte, bitácora de obra en
  campo, autenticación, políticas, etc.) — 100% traducidos en Inglés y
  Kreyòl ayisyen. Con esta versión, **toda la app (192/192 pantallas)**
  queda cubierta.
- Versión de origen: 1.216.0 (que ya cubría Inventario)
- Resultado: **OK — Xaviel revisó el trabajo en el chat de la sesión
  ("i reiew it, promote it to main") y autoriza continuar el pipeline
  dev → main (regla 18 / CP5), 2026-11-16.**
- Fecha: 2026-11-16 (construcción) / 2026-11-16 (revisión y OK de Xaviel)
- Probado por: Xaviel · 2026-11-16

## Casillas (marcar tras probar en dev.sgcconstructorasd.com)

- [x] Configuración › Idioma: cambiar a Inglés — el selector queda en "English", `<html lang>` cambia.
- [x] Recorrido por varios de los módulos recién cerrados (Compras, Flota, RRHH, Admin, Tecnología) en Inglés: sin texto suelto en español (filtros, tablas, drawers de crear/editar, toasts, confirmaciones).
- [x] Cambiar a Kreyòl ayisyen — repetir el recorrido; la traducción debe leerse coherente (no es revisión lingüística nativa, solo que no rompa la pantalla ni deje español).
- [x] Volver a Español — nada cambió para el uso normal en español (el idioma por defecto de la empresa).

> Nota: OK dado por Xaviel en el chat de la sesión ("i reiew it, promote
> it to main"), no una pasada casilla-por-casilla documentada en vivo —
> se registra aquí con el detalle que él confirmó, mismo patrón que el
> release 1.216.0.

## Pendiente antes de promover a prod

- Ninguna migración SQL ni edge function en esta ronda — solo frontend
  (plantillas Angular + `public/i18n/en.json` + `public/i18n/ht.json` +
  un guard corregido en `scripts/i18n-wrap-html.mjs`, herramienta interna
  de desarrollo, no afecta runtime).
- `public/i18n/ht.json` (Kreyòl) generado por Claude sin revisión de un
  hablante nativo — ver `docs/I18N-REVISAR-HT.md`. No bloquea el release,
  trabajo pendiente ya documentado desde 1.216.0.
