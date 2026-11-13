# Release 1.215.0

- Equipo/tester: Xaviel
- Qué se probó: ronda DO (PROMPT-144) — Apoyo de transporte (acción "Aprobar"),
  Organigrama en árbol, Reclutamiento + vista "Candidatos" nueva (CV real +
  CV leído por IA + archivado), módulo Claude (3 arreglos de interfaz) y
  módulo Skills (ámbito equipo, métricas, Compa sugiere skills, "Sugerir con
  IA", plantillas guiadas, tags, historial de versiones).
- Versión de origen: 1.214.0
- Resultado: **OK — Xaviel probó en dev.sgcconstructorasd.com y autoriza
  continuar el pipeline dev → main (regla 18 / CP5).**
- Fecha: 2026-11-13 (construcción) / 2026-11-13 (prueba y OK de Xaviel)
- Probado por: Xaviel · 2026-11-13

## Casillas

- [x] Apoyo de transporte (`/transporte/apoyo`): acción "Aprobar" visible en un apoyo pendiente, abre el mini-formulario de vehículo/chofer/fecha.
- [x] RRHH › Organigrama: se ve como árbol (jefe → reportes), no como lista plana.
- [x] RRHH › Reclutamiento y RRHH › Candidatos: candidato con los campos nuevos, CV subido, vista "Candidatos" con buscador y pestañas Activos/Archivados.
- [x] Claude (`/claude`): Auditoría › Conexiones sin encabezado duplicado; Crear una skill en dos columnas; enlace a "Mi conexión" funciona.
- [x] Claude › Skills: tags visibles en la biblioteca, botón "Historial" abre el historial de versiones, plantillas guiadas precargan Pasos/Ejemplo al crear.

> Nota: OK dado por Xaviel en el chat de la sesión ("i test it" + "i aprove all these stuff"), no una pasada casilla-por-casilla documentada en vivo — se registra aquí con el detalle que él confirmó.

## Pendiente antes de promover a prod

- Migraciones nuevas de esta ronda (`sql/2026-11-12-do5-*`, `do6-*`, `do10-*`)
  están SOLO en dev — aplicarlas a prod al mezclar a `main`.
- Edge functions nuevas/extendidas (`rrhh-leer-cv`, `claude-skill-sugerir`,
  y el redeploy de `assistant`/`claude-borrador`/`mcp` por el tool nuevo de
  Compa) están SOLO en dev — desplegar a prod al mezclar a `main`.
- Aprobar el tablero visual "Organigrama v2" en Claude Design (`docs/ORGANIGRAMA-V2-FICHA.md`) antes de escribir el CSS final de esa pantalla.
- El rating 👍/👎 de skills es un contador simple sin dedupe por persona (simplificación consciente, documentada en HANDOFF.md).
