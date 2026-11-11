# Release 1.213.0

- Equipo/tester: Xaviel
- Qué se probó: ronda DM (PROMPT-140, DM1-DM6) — módulo Claude (biblioteca de
  skills, Setup, Crear, Auditoría), agente de pendientes (nota diaria/semanal),
  4 reportes de Soporte de Raykler resueltos/instrumentados, triaje de las 38+
  firmas de error, fix de hosting (chunk perdido → 404 real).
- Versión de origen: 1.212.0
- Resultado: **pendiente de prueba de Xaviel** (todavía no se ha promovido a dev/main)
- Fecha: 2026-11-10

## Casillas

### Módulo Claude (`/claude`)
- [ ] Inicio: las 4 casillas del Setup se marcan y quedan guardadas; "Descargar Setup inicial" baja un .zip con 6 skills + LEEME + hoja de buenas prácticas.
- [ ] "Mi conexión" (antes `/configuracion/claude`) sigue funcionando igual, ahora dentro de la pestaña Inicio.
- [ ] Skills: las 6 de arranque aparecen publicadas; subir un `.md`/`.zip` nuevo lo guarda como skill personal; un secreto (ej. `sk-ant-...`) se rechaza con mensaje claro.
- [ ] Crear: el formulario guiado genera un `SKILL.md` con vista previa y lo guarda como personal.
- [ ] Proponer una skill personal a "mi rol" o "la empresa" la deja en `propuesta` (o `requiere_revision` si trae `.py/.sh/.js`); un admin/Tecnología la puede Aprobar o Devolver.
- [ ] Auditoría (solo admin/Tecnología): Técnica muestra el enlace al doc; Encuesta guarda la respuesta y la puedes editar; Organización muestra los datos sembrados y se puede editar la nota; Conexiones muestra el panel de `/admin/claude` de siempre.
- [ ] `/configuracion/claude` y `/admin/claude` redirigen a `/claude` sin romper nada.

### Agente de pendientes (Tecnología › Agentes)
- [ ] Botón "Probar ahora" crea/actualiza una nota "Pendientes (PRUEBA)" sin tocar la nota fija.
- [ ] La nota fija "Pendientes" (Notas, ámbito dev) aparece con secciones Hoy/Esta semana/Historial.
- [ ] Marcar a mano una casilla de la nota y volver a correr "Probar ahora" NO la reabre.
- [ ] Familia `agente_pendientes` aparece **apagada en prod, encendida en dev** (Tecnología › Agentes o Envíos automáticos).

### Reportes de Soporte / errores
- [ ] Compras › Órdenes: al no poder marcar "recibida", sale un botón "Registrar entrada ahora" (antes era un aviso sin salida).
- [ ] Inventario › Requisiciones: "Quitar" un renglón pide el motivo en un panel (ya no un `prompt()` nativo).
- [ ] Inventario › un conduce cualquiera: aparecen "← Anterior · Siguiente →" (si se llegó desde la lista) y "Siguiente pendiente para mí"; las flechas del teclado funcionan.
- [ ] Flota › Combustible: registrar una echada el mismo día que un mantenimiento con más kilometraje ya NO da "function does not exist" (ya corregido en prod desde el 10-nov, verificar que sigue bien).
- [ ] Tecnología › Reportes de errores: las firmas reclasificadas (fecha pasada, GPS denegado, reglas de conduce, existencia insuficiente) aparecen como "regla de negocio", no como abiertas.

### Hosting
- [ ] `curl -I https://sgcconstructorasd.com/algo-que-no-existe.js` da 404 real (no 200 con el HTML de la app) — **probar en un deploy de PREVIEW antes de promover a prod** (riesgo de romper el ruteo si algo depende del catch-all).

## Pendiente antes de promover a prod (ver reporte final / HANDOFF)

- Migraciones DM1/DM2/DM4/DM4b (módulo Claude completo + agente de pendientes)
  están SOLO en dev — faltan en prod hasta que este PR se mezcle.
- Encender `claude_skills_conector` y la familia `agente_pendientes` en prod:
  decisión de Xaviel, después de revisar la auditoría.
- Cerrar en prod los reportes 28e423b1/c1102070/1e56426e
  (`scripts/data-fixes/2026-11-10-dm5-cerrar-reportes-raykler.mjs --env prod --yes`)
  una vez el código de esta rama llegue a prod — hoy solo se cerró 1a91a8cd
  (arreglo 100% de servidor, ya vivo).
- Decidir aprobadores de `tecnologia.claude_administrar` (default: admin/Tecnología).
- Exportar manualmente de la consola de Claude la lista real de asientos/
  conectores/skills y confirmarla en Auditoría › Organización.
- Probar el fix de `vercel.json` en un deploy de preview antes de confiar en él
  en prod (regex de rewrite nueva).
