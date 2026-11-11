# MÓDULO CLAUDE — SGC (DM1-DM4, ronda DM, 10-nov-2026)

Ruta `/claude` (sin gate de módulo — todo usuario autenticado, como Notas/Configuración).
Pestañas: **Inicio** (Setup + Mi conexión) · **Skills** (biblioteca) · **Crear**
(skill guiada) · **Auditoría** (solo `tecnologia.claude_auditoria`).

## Qué absorbe (nada se borra)

- `/configuracion/claude` (`ConfiguracionClaude`) → redirige a `/claude`; el
  componente sigue vivo, embebido en la pestaña **Inicio** como "Mi conexión".
- `/admin/claude` (`AdminClaude`) → redirige a `/claude?tab=auditoria`; el
  componente sigue vivo, embebido en **Auditoría › Conexiones**.

## Datos (DM1, `sql/2026-11-10-dm1-claude-modulo.sql`)

`sgc.claude_skills` + `sgc.claude_skill_versiones` (biblioteca con versionado),
`sgc.claude_packs` + `sgc.claude_pack_items` (paquetes, incl. "Setup inicial"),
`sgc.claude_progreso` (checklist del Setup por persona), `sgc.claude_encuesta_respuestas`
(encuesta N1c), `sgc.claude_org_info` (sección editable "Cómo está configurada
nuestra organización"). Bucket privado `claude-skills`. RLS: lo mío + lo
publicado para mi rol/empresa; administrar (aprobar/publicar/archivar) gatea
por `tecnologia.claude_administrar`; auditoría por `tecnologia.claude_auditoria`.

## Edges

- `claude-skill-validar` — valida (tamaño ≤10MB, frontmatter, secretos, código
  ejecutable) y guarda un archivo como skill (nueva o nueva versión).
- `claude-skill-descargar` — zip de una skill con `LEEME-INSTALAR.md` generado.
- `claude-pack-zip` — zip de un paquete completo (todas sus skills + LEEME + guías).

Las tres respetan RLS vía el JWT de quien llama (no usan `service_role` para
decidir qué se ve, solo para leer el archivo ya confirmado visible). Lectura/
escritura de `.zip` sin dependencias — `supabase/functions/_shared/zip.ts`
(STORE al escribir; STORE+DEFLATE nativo de Deno al leer), probado contra un
zip real de PowerShell `Compress-Archive` y contra el escritor propio.

## Reglas de una skill (DM-05/06) — releídas de la doc vigente de Claude

Fuente: <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>
(releída 10-nov-2026; producto en beta, puede cambiar).

- `name`: máx. 64 caracteres, solo minúsculas/números/guiones, sin tags XML,
  **sin** las palabras `claude`/`anthropic`.
- `description`: no vacía, máx. 1024 caracteres, sin tags XML (aquí: sin `<`/`>`),
  debe decir QUÉ hace y CUÁNDO usarla.
- Custom Skills se suben como `.zip` en claude.ai (Pro/Max/Ultra/Team/Enterprise
  con ejecución de código activada) — compartidas a nivel de **workspace** en la
  API, no sincronizan entre claude.ai/API/Claude Code.
- Anthropic Enterprise ofrece "Skill content scanning" para `.zip` subidos en
  claude.ai — no cubre lo subido por la API/consola. El escaneo propio de
  `claude-skill-validar` (secretos + código ejecutable) es independiente de eso
  y corre siempre, sea cual sea el plan.

Riesgos documentados por Anthropic que motivan DM-06 (código ejecutable →
revisión) y la hoja de buenas prácticas de datos (DM-12): una skill puede dar
instrucciones que hagan que Claude llame herramientas o ejecute código de forma
dañina; usar solo skills de fuentes de confianza.

## Setup inicial (DM-10, DM-12)

6 skills sembradas, `publicada`/`empresa`/sin código: `pedir-bien-a-la-ia`,
`resumir-documento`, `redactar-oficio-formal`, `notas-a-acta`, `revisar-cotizacion`,
`usar-el-sgc-desde-ia`. Pack `setup-inicial` las agrupa + `LEEME-INSTALAR.md` +
hoja de buenas prácticas de datos.

## Conector fase 2 — apagado (DM4)

Ver `docs/CLAUDE-CONECTOR.md` §DM4 y `PERMISOS-TOOLS.md` §DM4.

## Pendientes físicos de Xaviel

1. Revisar y editar el texto de las 6 skills de arranque si hace falta.
2. Decidir aprobadores de `tecnologia.claude_administrar` (default: quien tenga
   el módulo Tecnología completo + admin).
3. Exportar de la consola de Claude (owner) la lista real de asientos/
   conectores/skills de la organización y pegarla en Auditoría › Organización
   (ya hay un primer volcado del 10-nov-2026 en `sgc.claude_org_info`, ver
   `extras/ORGANIZACION-CLAUDE-INVENTARIO.md` del handoff de la ronda).
4. Pedir el tablero visual (Claude Design) antes de aprobar CSS nuevo — hoy
   el módulo usa solo clases existentes (`sgc-btn`, `sgc-badge`, `sgc-card`).
5. Encender `claude_skills_conector` cuando esté conforme con la auditoría.
