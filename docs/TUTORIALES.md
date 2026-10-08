# TUTORIALES — videos de "cómo hacer" (CK5)

Videos cortos (30–90 s, sin audio, texto en pantalla + subtítulos) que se muestran en
**Dudas** (web) y **Soporte y ayuda** (app), arriba de los pasos de cada guía.

## Estado
- ✅ **Web lista para mostrar videos:** el reproductor en Dudas (sin autoplay, con póster,
  subtítulos y duración) + el filtro **"Con video"** ya están. Los campos de video viven en
  `ayuda_contenido.contenido` (jsonb): `video_path`, `poster_path`, `vtt_path`, `duracion_s`,
  `plataforma` (`web|app`). Bucket privado `tutoriales` creado (lectura por URL firmada).
- ⏳ **Falta grabar los videos** — es un paso físico (ver abajo).

## Herramienta
**Playwright + `ffmpeg-static`** (gratis). Remotion NO (su licencia cobra a empresas de >3
empleados). El proyecto vive en `tutoriales/` (fuera del build de la web, su propio
`package.json`).

## Privacidad — la regla que manda sobre todo
1. Se graba **solo en dev** (`dev.sgcconstructorasd.com` / `app-dev…`). El candado aborta si
   la URL o el ref es de prod.
2. Se graba **solo con usuarios demo** (rol `revisor_tiendas` o flag `tutorial_demo`), que por
   RLS ven **solo la OBRA DEMO**. Nunca admin (salta la RLS).
3. **Candado de texto antes de exportar:** el script lee el texto visible de cada pantalla
   (`innerText`) y aborta si aparece un nombre/cédula/placa fuera de la lista demo.
4. 👤 **Xaviel revisa cada video antes de subirlo a prod** (lista de verificación abajo).

## Pasos físicos pendientes (no automatizables)
1. Crear los usuarios demo por rol en dev + extender el predicado `revisor_solo_demo` a un
   helper `es_usuario_demo()` (= `revisor_tiendas` **o** flag `tutorial_demo`) — SQL aditivo,
   **solo dev**. (Pendiente: toca RLS de varias tablas; hacerlo con cuidado y verificar que
   cada demo ve solo la OBRA DEMO.)
2. Ampliar los datos demo de la OBRA DEMO (obras, personas con cédulas `000-…`, vehículos
   `DEMO-00x`, artículos, requisiciones, conduces, una ruta, echadas, un mantenimiento).
3. Correr `npm run videos` en `tutoriales/` (contra dev, con las credenciales demo en
   `tutoriales/.env.local`). Requiere login real → **paso físico de Xaviel / sesión dedicada**.
4. Subir con `scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs --env dev` → revisar →
   `--env prod` (tras el OK de Xaviel).

## Guiones (lote 1)
App (360×640 @3x): combustible · tomar/soltar vehículo · crear ruta · inspección · bitácora
del día · recibir conduce · pedir material · Compa. Web (1920×1080): aprobar/despachar
requisición · crear conduce · conduce externo desde requisición · transferir + "Entregar a"
· registrar mantenimiento · autorizar chofer privado · **crear un apoyo de transporte** ·
**Misael asigna un ticket y lo sigue en Mis choferes**.

## Lista de verificación de privacidad (antes de subir a prod)
- [ ] El video se grabó en dev (nunca prod).
- [ ] Solo aparece la OBRA DEMO y datos `DEMO-…` / `000-…`.
- [ ] No se ve ningún nombre/cédula/placa real.
- [ ] Sin audio; texto en español legible; subtítulos `.vtt` presentes.
- [ ] Duración 30–90 s; MP4 H.264; ≤15 MB.

## Formato de salida
MP4 H.264, 30 fps, sin audio; póster JPG; `.vtt`. Nombre `{plataforma}-{guia}-v{n}.mp4`.
