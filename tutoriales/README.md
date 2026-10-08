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

## Estado del scaffold
Hecho: `lib/privacy-lock.mjs` (el candado), estructura y `package.json`. 
**Pendiente (sesión dedicada, requiere login en dev):** `run.mjs` (grabar con Playwright),
`render/` (portada + barra de pasos + cierre + VTT con ffmpeg), `guiones/*.mjs` (un archivo por
video) y `scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs` (subida).

## Puesta en marcha (cuando se retome)
```
cd tutoriales
npm install
# credenciales demo de dev en tutoriales/.env.local (nunca en el repo)
npm run video -- web-apoyo-transporte     # un video
npm run videos                            # todos
```
