# Release 1.212.0

- Equipo/tester: Xaviel
- Qué se probó: ronda DL — seguimiento de hallazgos de WhatsApp (responsable + estado), recordatorios automáticos (wa-seguimiento), recap diario/semanal con PDF (wa-recap), "Convertir" real a tarea, fix visual del desplegable Proyecto (DL1), insignia de aviso de privacidad (DL2), accesos de Gerencia a inventario tecnológico y "Entrar como" más confiable (DL7/N6).
- Versión de origen: 1.211.0
- Resultado: **pendiente de prueba de Xaviel** (todavía no se ha promovido a dev/main)
- Fecha: 2026-11-10

## Casillas

- [ ] Aviso de privacidad: la insignia de Grupos muestra "publicado el {fecha}" / "sin confirmar" / "no aplica (ignorado)" según corresponda, con `title` explicativo.
- [ ] El desplegable "Proyecto" de la 2.ª tarjeta de Grupos ya no queda tapado por las tarjetas de abajo.
- [ ] Hallazgos: se puede asignar/cambiar responsable, ver el estado de seguimiento (activo/resuelto/vencido/…), y marcar "Ya está resuelto".
- [ ] "Convertir" a Tarea crea de verdad una tarea en `sgc.tareas` (verificar en Tareas que aparece); Requisición/Reunión siguen el flujo manual (copiar texto).
- [ ] Grupos: se pueden editar responsables y destinatarios del recap (diario/semanal) desde el drawer "Responsables / recap".
- [ ] "Probar mis recordatorios" y "Probar recap" (por grupo) llegan por correo SOLO a quien los pide, marcados [PRUEBA].
- [ ] Pestaña Resúmenes: lista paginada, filtros (periodo/grupo/fechas), "Descargar PDF" funciona para un recap ya generado.
- [ ] Estado: las 3 familias nuevas (`wa_recordatorios`, `wa_recap_diario`, `wa_recap_semanal`) aparecen **apagadas**.
- [ ] Compa: "¿qué me falta de los grupos?" responde solo con lo propio (probar con un usuario SIN el permiso de WhatsApp).
- [ ] Gerencia ve "Inventario tecnológico" en el menú (probado con Eduardo NG o un usuario de prueba con ese rol).
- [ ] "Entrar como" funciona de nuevo (recargar, reintentar) y, si falla, la lista de usuarios de Gestión de Usuarios **no desaparece**.
- [ ] Estado → "Configuración del puente de grupos": un admin puede editar modo por defecto/tope de respuestas/presupuesto/recordatorio WhatsApp/mínimo del recap, y se guarda.

## Pendiente antes de promover a prod (ver reporte final / HANDOFF)

- Encender las familias una por una (recap primero, luego recordatorios) — quedan apagadas a propósito.
- Confirmar con Legal (Ley 172-13) el nuevo flujo de PDF por correo (`docs/DATOS-Y-TERCEROS.md`, flag DL).
- Desplegar a prod `admin-entrar-como`/`admin-fin-impersonacion` con `verify_jwt=false` (comando listo en el reporte).
- Decidir si el rol Gerencia debe conservar `tecnologia.inventario` (ya aplicado en dev).
