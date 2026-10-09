# tutoriales/ — grabación de videos de "cómo hacer" (CK5)

Proyecto aparte (su propio `package.json`, fuera del build de la web). Graba videos cortos
con **Playwright + ffmpeg-static** y los sube al bucket privado `tutoriales`.

> **Lee primero [`../docs/TUTORIALES.md`](../docs/TUTORIALES.md)** — formato, privacidad y la
> lista de verificación que Xaviel usa antes de subir a prod.

## Reglas (resumen)
- **Solo dev.** El candado (`lib/privacy-lock.mjs`) aborta si la URL/ref es de prod.
- **Solo usuarios demo** (rol `revisor_tiendas` o flag `tutorial_demo`): ven solo la OBRA DEMO.
- **Candado de texto** antes de exportar: aborta si ve una cédula/placa/nombre real.
- 👤 Xaviel revisa cada video antes de subir a prod.

## Estado del tooling
- `lib/privacy-lock.mjs` — el candado (prod / usuario no-demo / texto con datos reales).
- `lib/record.mjs` — **motor de grabación**: login, descarta onboarding, PORTADA (2 s) +
  BARRA DE PASOS (colores CB) + CIERRE (2 s) horneados en el propio video, y genera el
  `.vtt` con los tiempos reales de cada paso. ffmpeg: webm → mp4 + póster.
- `guiones/*.mjs` — un archivo declarativo por video (`web-*` = web, `app-*` = app). Cada
  paso tiene `texto` (sale en la barra y como subtítulo) y un `run(ctx)` opcional.
- `run.mjs` — cargador (`node run.mjs <id>` o `--all`).
- `../scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs` — subida al bucket `tutoriales`
  + escribe los campos de video en `sgc.ayuda_contenido` (DRY-RUN por defecto, regla 19).

## Uso
```
cd tutoriales && npm install            # (una vez; credenciales demo en ../.env.local)
# arrancar la web en dev en otra terminal, en la raíz del repo:
#   npm run env:dev && npm start        # ng serve → localhost:4200 contra Supabase dev
node run.mjs web-apoyo-transporte       # un video → salida/{id}-v1.mp4 + .jpg + .vtt
node run.mjs --all                      # todos los guiones web
# subir (tras ver cada video):
node ../scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs --env dev           # dry-run
node ../scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs --env dev --apply   # sube a dev
```

## Molde de un guion nuevo
Copia `guiones/web-apoyo-transporte.mjs` (flujo verificado). Los `web-*` restantes son
**demostrativos** (navegan y resaltan; no envían, para no crear datos): al grabarlos, ajusta
los selectores si cambió la pantalla y, si hay datos demo, conviértelos en flujo completo.
