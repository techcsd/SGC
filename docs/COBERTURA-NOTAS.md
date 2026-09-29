# COBERTURA DE NOTAS — carpeta `imp 28092026` (28-sep 2026 →)

> **Regla:** cada párrafo que Xaviel pega aparece aquí **una vez por tanda en que lo pegó**, con su ID, dónde vive en los prompts y su estado real. Si una nota no está en esta tabla, **es un error de este documento**. La numeración sigue la de `..\imp 14092026\COBERTURA-NOTAS.md` (filas 1-82). Copia en el repo (`docs/COBERTURA-NOTAS.md`) sincronizada con la de la carpeta de improvements.
>
> Estados: ✅ en prod (versión) · 🔧 construido sin release · 🆕 esta tanda · 🧪 en dev · 👤 pendiente físico de Xaviel.

| # | Nota de Xaviel (resumen literal) | Pegada | ID | Dónde | Estado |
|---|---|---|---|---|---|
| 83 | *"We need to give to the both systems a modern look, without changing the way that they are organizated or works, only the look, to make them mor modern and the sgc and csd app more stylized, with a modern look… this is a big one, so lets take it with precition and think in all the features and screens and workflows…"* + respuestas del chat: clean SaaS moderno y amigable *"without exagerate"*; vidrio en algunos elementos, *"nothing that looks maded by an ai"*; navy + naranja unificado; Inter | **28-sep** | **CB1-CB10** | CONTEXTO-35 (todo) · canvas CB · **PROMPT-72 F0-F8** · **PROMPT-73 F0-F8** | 🧪 **Web CB1-CB3 en dev 1.148.0-dev** (rama `feature/cb-rediseno` → `dev`): tokens v2 navy+naranja, Inter+Inter Tight auto-hospedadas, vidrio (topbar/lote/mapa), guards `verify-no-ai-tropes` + blanco-sobre-naranja, shell "inset" + header de vidrio, componentes base (accent/status-pill con punto/emphasis navy/tabla/inputs) y galería `/tecnologia/design-system` al día. **Rollout FASE3-6** (repintado por módulo): heredan la piel nueva por tokens; falta el barrido de capturas antes/después por pantalla — necesita login admin en dev (`qa/visual/login.mjs`, físico de Xaviel). **App (PROMPT-73)**: aparte. Propuestas abiertas: **CB-P1** (buscador global + Compa en header web), **CB-P2** (barra inferior + buscador en home de la app) → DEFAULT §D: no se construyen |

**Pendientes físicos de Xaviel:**
- Generar la sesión de captura en dev: `npm start` → `node qa/visual/login.mjs` (entra como admin) → `node qa/visual/capturar.mjs antes` / `… despues` para el barrido completo antes/después.
- Recorrer `qa/visual/cb/…` en ambos repos, probar en `dev.sgcconstructorasd.com` como admin / Raykler / chofer.
- Decidir CB-P1 / CB-P2 (otra ronda).
- OK para prod (PR `dev → main`, 1.148.0).
