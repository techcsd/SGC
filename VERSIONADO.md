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
