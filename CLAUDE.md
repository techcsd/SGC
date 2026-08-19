# SGC — Sistema de Gestión de Constructora SD

Internal ERP-style web app for Constructora SD (construction company, Dominican Republic). **UI language: Spanish.** Built and maintained solo by Xavier (Tecnología) with Claude Code.

## Stack
Angular 21 (standalone + signals) · Supabase (schema `sgc`: auth, RLS, edge functions) · Vercel (prod: sgcconstructorasd.com, previously sgc-ashen.vercel.app) · Resend (transactional email) · mammoth (docx extraction) · xlsx

## Commands
- Dev server: `npm start` · Build check: `npm run build` · Tests: `npm test` (vitest)
- Supabase: CLI installed; access token in env var `SUPABASE_ACCESS_TOKEN`. You may apply migrations, fix RLS/grants, and deploy edge functions yourself.
- SQL history lives in `sql/` and `supabase/`.

## Modules (keep this list updated)
Dashboard (KPIs) · Bitácora de obra (parte diario, visita a obra, incidente/accidente) · Inventario (incl. "Conduces por implementar" — items libres AU4 sin vincular) · Flota · Solicitud de movimiento (logística: ingeniero→transporte, sin gate de módulo — todo usuario autenticado; referentes crean/asignan ruta) · Solicitudes (materiales, órdenes de compra) · Conduces / trazabilidad de transporte · Documentos (plantillas → rellenar → descargar; template creation gated by `plantillas` module) · Legal (expedientes, contratos, aprobaciones — `legal` module, `abogado` role) · Tareas (asignar/seguir — `tareas` module gates assigning; everyone has "Mis tareas") · Mensajería (chat interno realtime, DMs + grupos + archivos, sin gate de módulo) · Notas (personales + compartidas ver/editar, sin gate de módulo — como Mensajería) · RRHH (empleados, asistencia, ausencias/vacaciones, docs de empleado) · Proyectos (+ Ranking de Encargados KPI) · Tecnología (+ QA: gestor de pruebas — casos/corridas/resultados; + Issues/Jira interno — board Kanban de tareas/bugs/mejoras, solo `es_tecnologia`, "crear issue desde reporte de error"; gating restringido `es_tecnologia`) · Reportes y comentarios (admin) · Administración (usuarios, roles, permisos) · Dudas (ayuda)

## Módulos de permisos (sgc.roles.modulos text[])
inventario · compras · rrhh · proyectos · flota · bitacora · documentos · plantillas · legal · tareas · tecnologia · direccion · admin. (Mensajería y "Mis tareas" no requieren módulo — todo usuario autenticado.) Cuando agregues un módulo nuevo: añádelo a MODULOS_DISPONIBLES en roles.service.ts, ponle guard en las rutas, entrada en shell.ts, y `array_append` al rol admin (gotcha recurrente).

## Hard rules (recurring feedback from Xavier — never skip)
1. **Interconnection**: any change in one module must update every related module — dashboard KPIs, notification badges, and the receiving side of any request (a Solicitud must show up where its approver/receiver works).
2. **Roles**: every new section, button, or action must respect the role permissions defined in Administración.
3. **DB integrity**: when touching tables, verify RLS policies, schema grants, and sequence grants (past prod bugs: `permission denied for schema sgc`, `permission denied for sequence roles_id_seq`). Validate inputs to prevent bad data.
4. **Verify before reporting done**: `npm run build` must pass and the affected workflow must be tested end-to-end.
5. **URLs**: auth/email redirect links must point to the production domain — never localhost.
6. Real workflows first: model features on how the company actually works (reference docs below), ERP patterns (Odoo/Oracle style) where they add real value.
7. **Architect mindset**: think like a Senior Software Architect building an ERP that will be maintained for many years, not like a developer completing a single feature. You are encouraged to challenge existing architectural decisions when a better long-term design exists — propose it (or apply it, per the working agreement) instead of silently following the current pattern.
8. **⭐ AW12 — SVG/imágenes en vez de emojis para iconos** (regla permanente, junto a AT11): la iconografía de la UI va por SVG (inline, `stroke="currentColor"`), no por emojis. Los emojis solo como CONTENIDO (chat, stickers), nunca como icono de botón/estado/tab. Al tocar una pantalla, migra sus emojis-icono a SVG (sweep gradual). Regla espejo en `.claude/CLAUDE.md`.
9. **⭐ AT11 — toda data enviada es visualizable**: cualquier dato que la app/web capture o envíe DEBE poder verse en algún lado del sistema. Si algo se envía y no se puede ver, es un bug.

## Versionado — REGLA permanente (Y1)
Toda actualización que sube a `main` (web o app) DEBE registrarse en el historial de versiones (`sgc.app_versiones`), automáticamente y SIEMPRE con el mismo formato estructurado: `titulo` + `cambios: [{ t: nuevo|mejora|arreglo|seguridad, d: texto }]` + `url` (link a esa versión). La UI (`admin/historial-versiones`) pinta chips por tipo para ambas plataformas; el texto plano legacy es solo fallback. **Regla completa + checklist en [`VERSIONADO.md`](./VERSIONADO.md).**
- **Web**: bump `package.json` → añade la entrada en `release-notes.json` bajo `web.<version>` → el hook `prebuild` corre `verify-version-notes.mjs` (**FALLA el build/deploy** si falta la entrada estructurada — paridad con la móvil) y luego `gen-version.mjs` (la mete en `version.ts`); el paso `postbuild` (`registrar-version-web.mjs`) la registra en el deploy vía `registrar_version` (idempotente). Requiere `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` en el entorno de build de Vercel; si faltan, el auto-registro al arrancar (`autoRegistrarVersionWeb`, shell) es la red de seguridad.
- **App móvil (csd-app)**: el script de release (`release-apk.mjs`) registra SIEMPRE la versión con notas estructuradas y falla el release si no pudo registrarse.
- RPC: `sgc.registrar_version(p_plataforma, p_version, p_notas, p_titulo, p_cambios)` — solo rellena campos vacíos, nunca sobrescribe notas ya editadas por un admin.

## Reference docs (real company documents/templates)
- `C:\Users\xavie\Desktop\X Dev\Constructora SD\` → `EXTRACTO DE ONE DRIVE\` and `...\PLANTILLAS\`
- Project documentation: `C:\Users\xavie\Desktop\X Dev\Projects documentations\SGC\`
