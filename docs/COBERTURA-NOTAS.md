# COBERTURA DE NOTAS — carpeta `imp 28092026` (28-sep 2026 →)

> **Regla:** cada párrafo que Xaviel pega aparece aquí **una vez por tanda en que lo pegó**, con su ID, dónde vive en los prompts y su estado real. Si una nota no está en esta tabla, **es un error de este documento**. La numeración sigue la de `..\imp 14092026\COBERTURA-NOTAS.md` (filas 1-82). Copia en el repo (`docs/COBERTURA-NOTAS.md`) sincronizada con la de la carpeta de improvements.
>
> Estados: ✅ en prod (versión) · 🔧 construido sin release · 🆕 esta tanda · 🧪 en dev · 👤 pendiente físico de Xaviel.

| # | Nota de Xaviel (resumen literal) | Pegada | ID | Dónde | Estado |
|---|---|---|---|---|---|
| 83 | *"We need to give to the both systems a modern look, without changing the way that they are organizated or works, only the look, to make them mor modern and the sgc and csd app more stylized, with a modern look… this is a big one, so lets take it with precition and think in all the features and screens and workflows…"* + respuestas del chat: clean SaaS moderno y amigable *"without exagerate"*; vidrio en algunos elementos, *"nothing that looks maded by an ai"*; navy + naranja unificado; Inter | **28-sep** | **CB1-CB10** | CONTEXTO-35 (todo) · canvas CB · **PROMPT-72 F0-F8** · **PROMPT-73 F0-F8** | ✅ **Web SHIPPED A PROD 1.148.0** (Xaviel dio OK → merge `dev→main` `b288107`). CB1-CB7 completo: tokens v2 navy+naranja, Inter/Inter Tight auto-hospedadas, vidrio, shell "inset"+header vidrio, componentes base (accent/status-pill+punto/emphasis navy/tabla/inputs)+galería; rollout FASE3-6 (piel por tokens) + card-stripes fuera en 18 pantallas + 3 dashboards; FASE7 a11y (guard `verify-contraste` AA 2 temas, naranja-texto→accent-hover) + perf (fuentes 91KB, glass≤2, 0 SVG fill fijo). Guards nuevos: `verify-no-ai-tropes`, `verify-contraste`. Barrido visual `qa/visual/cb/` (608 capturas, índice). **App (PROMPT-73)**: aparte. Propuestas abiertas: **CB-P1** (buscador global + Compa header web), **CB-P2** (barra inferior + buscador home app) → DEFAULT §D: no se construyen |

**Pendientes físicos de Xaviel:**
- Generar la sesión de captura en dev: `npm start` → `node qa/visual/login.mjs` (entra como admin) → `node qa/visual/capturar.mjs antes` / `… despues` para el barrido completo antes/después.
- Recorrer `qa/visual/cb/…` en ambos repos, probar en `dev.sgcconstructorasd.com` como admin / Raykler / chofer.
- Decidir CB-P1 / CB-P2 (otra ronda).
- OK para prod (PR `dev → main`, 1.148.0).
