---
name: sgc-video
description: Genera videos de SGC (promo/showcase y tutoriales how-to) en estilo motion-graphics "guiado" — la app a pantalla completa, cámara con close-up que sigue el cursor, captions, números que cuentan, voz es-DO (Ramona) + música. Hecho 100% por código con Remotion (sin After Effects/Premiere/Higgsfield). Úsalo cuando Xavier pida un video, promo, tutorial, o "cómo se hace" de la app.
---

# SGC — Motor de video (Remotion)

Todo vive en `tutoriales/motion/`. Render por código a mp4 1920x1080, sin herramientas de pago.
Estilo aprobado por Xavier (10/2026): **app a pantalla completa + cámara que hace close-up y SIGUE el cursor para guiar, con voz Ramona es-DO + música**. NO usar el viejo motor de captura (`tutoriales/lib/record.mjs`) para esto — ese quedó corto ("solo pantalla + voz, sin motion").

## Setup (ya hecho)
- `tutoriales/motion/` es un paquete npm aparte: `remotion @remotion/bundler @remotion/renderer react react-dom`.
- Assets en `tutoriales/motion/public/`: `inter.woff2`, `inter-tight.woff2`, `logo.png`, `music.mp3`, `shots/`, `voz/`.
- Voz: Azure Speech (es-DO `RamonaNeural`) vía `tutoriales/lib/voz.mjs`. Llave `AZURE_SPEECH_KEY` en `.env.local` (raíz). Sin llave → voz borrador (edge-tts), NO subir a prod.

## Composiciones (en `src/`)
- **Promo** (`Promo.tsx` + `render.mjs`): promo general con capturas reales de `public/shots/` (Ken Burns + chips). Secundario.
- **Demo** (`Demo.tsx` + `render-demo.mjs`): dashboard mock guiado (prueba de estilo).
- **Tutorial** (`Tutorial.tsx` + `render-tutorial.mjs`): **el formato principal**. Data-driven: cada tutorial = coreografía + pantalla mock + voz por paso.

## Kit reusable — `src/lib/kit.tsx`
`C` (paleta SGC), `BODY/HEAD` (Inter/InterTight), `cargarFuentes()`, `kf()` (interpola keyframes),
`<Camara beats>` (centra y hace zoom a un punto del mundo 1920x1080, **con clamp a los bordes** — nunca muestra vacío),
`<Cursor beats>` (se desliza, contra-escalado a tamaño fijo, pulso de clic),
`<Caption beats>`, `<CountUp>`, `<AppShell active highlight breadcrumb>` (sidebar+topbar), `<Boton>`, `<Campo>`, `<Drawer p titulo>`.

## Cómo AGREGAR un tutorial nuevo
1. **Coreografía** → `src/tutoriales/<id>.data.mjs` (JS plano, lo leen node y el bundle):
   ```js
   export const SCREEN = '<id>'; export const TITULO = '…';
   export const PASOS = [{ fase, cap, cam:{x,y,s}, click?, voz:'texto a narrar' }, …];
   ```
   `cam` = punto del mundo (1920x1080) + zoom `s` (1.0 = completo, 1.5 = close-up). `fase` = estado de la pantalla.
2. **Pantalla mock** → `src/tutoriales/<id>.screen.tsx`: `export const Pantalla: React.FC<{fase,frame,atOf}>` que dibuja la UI de SGC y cambia según `fase` (usa `atOf(fase)` para animar drawers/toasts por frame). Reusa `AppShell/Campo/Drawer/Boton`.
3. **Regístrala** en `src/tutoriales/registry.ts` (`SCREENS['<id>'] = Pantalla`).
4. **Renderiza**: `cd tutoriales/motion && node render-tutorial.mjs <id>` → sintetiza voz Ramona por paso, mide duración para sincronizar cámara/cursor/caption, y saca `salida/tutorial-<id>-v1.mp4`.

## Reglas de calidad (lo que a Xavier le gustó)
- Cámara SIEMPRE con close-up que sigue el cursor; nada estático al lado.
- Números que cuentan, barras que crecen, elementos que aparecen → "vivo".
- Clamp de cámara activo (sin bandas oscuras). `transform` sólo (GPU).
- Voz Ramona es-DO + música de fondo a ~0.1. Captions grandes abajo.
- Iconos SVG, nunca emojis (AW12). Datos de mentira SIEMPRE (OBRA DEMO, etc.).
- Mockups fieles al diseño real de SGC (navy `#1e3a5f` + naranja `#f97316`, Inter).
- Mostrar al usuario cada video y pedir OK antes de darlo por final. Abrir con `Invoke-Item` + `SendUserFile`.

## Pendientes / backlog de videos
Tutoriales a producir en este estilo (coreografía + mock c/u): aprobar-despachar, transferir-conduce,
entrada-inventario, conteo, crear-conduce, registrar-mantenimiento, apoyo-transporte, autorizar-chofer,
mis-choferes + 2 de instalación (CM1) + promo final general. Idioma: español (es-DO).
