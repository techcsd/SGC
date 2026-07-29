# Versionado — REGLA permanente (Y1)

> **Regla:** toda actualización que sube a `main` (web o app móvil) **DEBE** quedar
> registrada en el historial de versiones (`sgc.app_versiones`) con formato
> estructurado: `titulo` + `cambios: [{ t, d }]` + `url` (enlace a esa versión).
> La UI (`admin/historial-versiones` en web, `admin/versiones` en móvil) pinta
> chips por tipo para ambas plataformas. El texto plano es solo fallback legacy.
>
> Esto NO es opcional ni "si me acuerdo": está **automatizado y con guard** que
> falla el build/deploy si no se cumple.

## Formato de cada cambio

```jsonc
{ "t": "nuevo" | "mejora" | "arreglo" | "seguridad", "d": "texto legible del cambio" }
```

- `nuevo` — funcionalidad nueva · `mejora` — mejora de algo existente
- `arreglo` — bug corregido · `seguridad` — permisos/RLS/seguridad

## Qué número subir (`MAJOR.MINOR.PATCH`)

El esquema es **semver** (`X.Y.Z`). La regla real **no es "cuánto código cambió"**, es
**compatibilidad / impacto para el usuario**:

| Número | Sube cuando… | Ejemplos en SGC |
|--------|--------------|-----------------|
| **PATCH** `Z` → `1.34.`**`2`** | Arreglo o ajuste pequeño que **no cambia cómo se usa** nada | fix de fecha, color, un cálculo, un texto |
| **MINOR** `Y` → `1.`**`43`**`.0` | **Funcionalidad nueva** que se *suma* sin romper lo existente | conciliación de combustible, Gantt real, split Mis/Todas |
| **MAJOR** `X` → **`2`**`.0.0` | Un salto de **generación** que decidimos marcar (ver abajo) | — (aún no ha ocurrido) |

Como en SGC **todo se hace aditivo y retrocompatible** (regla dura del proyecto), casi
todo entra como **MINOR**; por eso el número del medio crece rápido y el primero se queda
en `1`. Eso es señal buena: significa que nunca hemos roto nada para el usuario.

### Cuándo pasar a `2.0.0` (MAJOR)

**No requiere reescribir el core ni cumple un umbral técnico automático — es una DECISIÓN.**
SGC es una app interna (no hay una API pública que "rompa" a terceros ni consumidores
externos; todo se despliega junto), así que el MAJOR sube solo cuando **conscientemente**
queremos comunicar *"esto es un antes y un después"*. Los casos típicos:

1. **Rediseño grande de la experiencia** — rehacer el shell/navegación o el look completo;
   el usuario "siente" que es otra app.
2. **Un cambio que obliga a re-aprender o migrar** — reestructurar un flujo central o los
   permisos de forma que la gente tenga que re-configurar cómo trabaja.
3. **Hito de negocio/producto** — "cerramos toda una etapa del ERP, esto es la v2".

Regla práctica: **seguir subiendo MINOR por feature y PATCH por fix**, y **reservar
`2.0.0` para un hito deliberado** (normalmente un rediseño visual o un rework de un flujo
central). No hay nada que lo dispare solo: cuando Xaviel decida que el conjunto ya merece
llamarse "generación 2", se hace el bump de MAJOR y se **reinician** `MINOR` y `PATCH` a
cero (`2.0.0`).

## WEB (este repo, SGC)

Pasos para cada versión que sube a `main`:

1. **Bump** `version` en `package.json` (semver: minor para features, patch para fixes).
2. **Notas**: añade la entrada en `release-notes.json` bajo `web.<version>`:
   ```jsonc
   "web": {
     "1.19.0": {
       "titulo": "Título corto de la versión",
       "cambios": [
         { "t": "nuevo", "d": "…" },
         { "t": "arreglo", "d": "…" }
       ]
     }
   }
   ```
3. `npm run build` (o el deploy de Vercel) ejecuta la cadena:
   - **`scripts/verify-version-notes.mjs`** (hook `prebuild`): **FALLA el build** si la
     versión actual no tiene entrada válida en `release-notes.json` (título + ≥1 cambio
     con `t` válido y `d` no vacío). Este es el guard de paridad con la móvil.
   - **`scripts/gen-version.mjs`** (hook `prebuild`): genera `src/environments/version.ts`
     con `APP_VERSION`, `APP_VERSION_TITULO`, `APP_VERSION_CAMBIOS` y `APP_VERSION_URL`
     (link al commit de GitHub de esa versión).
   - **`scripts/registrar-version-web.mjs`** (hook `postbuild`): registra la versión en
     `sgc.app_versiones` vía RPC `registrar_version` (idempotente). Requiere
     `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` en el entorno de build de Vercel.
4. **Red de seguridad**: si el postbuild no pudo registrar (faltaban envs), el arranque
   de la app (`autoRegistrarVersionWeb`, en el shell) registra la versión con las notas
   embebidas en `version.ts`. Así el historial nunca queda sin la versión desplegada.

El link (`url`) de cada versión apunta al commit de GitHub
(`https://github.com/techcsd/SGC/commit/<sha7>`), automático en Vercel (`VERCEL_GIT_*`)
o desde git en local.

## APP MÓVIL (repo csd-app)

El script de release (`release-apk.mjs`) registra SIEMPRE la versión con notas
estructuradas y **falla el release si no pudo registrarse**. La web replica ese
comportamiento con el guard `verify-version-notes.mjs`.

## RPC

`sgc.registrar_version(p_plataforma, p_version, p_notas, p_titulo, p_cambios)` — solo
rellena campos vacíos, **nunca sobrescribe** notas ya editadas por un admin.

## Checklist antes de `git push origin main` (web)

- [ ] `package.json` con la versión nueva.
- [ ] `release-notes.json` con `web.<version>` (título + cambios).
- [ ] `npm run build` verde (el guard valida las notas).
- [ ] Commit incluye `package.json`, `release-notes.json` y `src/environments/version.ts`.
