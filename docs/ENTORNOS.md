# Entornos — SGC (dev / prod) — BU1

Desde PROMPT-58 (BU1) el sistema tiene **dos entornos**. La regla madre (18) es:
**nada llega a producción sin haber vivido y probado en dev primero** — y los scripts lo hacen cumplir.

## Los dos entornos

| Capa | **prod** (producción) | **dev** (desarrollo) |
|---|---|---|
| Supabase | `jeeqhgccqefbqilntcpu` (csd-core) | **`fzfrnrvndzrjwyvdpkgg` (sgc-dev)** — misma org (Tech CSD), us-east-1, PG17 |
| Web | `sgcconstructorasd.com` ← rama `main` | **`dev.sgcconstructorasd.com`** ← rama `dev` |
| App PWA | `app.sgcconstructorasd.com` | `app-dev.sgcconstructorasd.com` (hijo, PROMPT-59) |
| Datos | reales | catálogos + operación **anonimizados** (nombres reales; email/cédula/teléfono no) |
| Correo | real (Resend) | **redirigido** a `Tecnologia@constructorasd.com` con asunto `[DEV → destinatarios]` |
| Push | real (FCM) | **apagado** (salvo tokens en `PUSH_ALLOWLIST`) |
| Cinta visual | — | **DEV** naranja (esquina) + `[DEV]` en el título + favicon naranja |

Los refs, URLs y keys de ambos viven en `.env.local` (gitignored): `SUPABASE_{PROJECT_REF,URL,ANON_KEY,SERVICE_ROLE_KEY}_{DEV,PROD}`, `SUPABASE_DB_PASSWORD_DEV`, `INFRA/WEATHER/CRONOGRAMA_SYNC_SECRET_DEV`, `QA_DEV_PASSWORD`.

## Cómo entrar a dev

- **Web dev:** https://dev.sgcconstructorasd.com (cuando el dominio esté asignado en Vercel — ver *Pasos físicos*).
- **Usuarios:** son los reales **anonimizados**. Email de login = `u-<8hex>@dev.constructorasd.local` (los de acceso por cédula: `e-<cédula-hash>@acceso.constructorasd.local`). El **nombre real se conserva** para probar como cada persona.
- **Contraseña:** una sola para todos = `QA_DEV_PASSWORD` (en `.env.local`).
- Para entrar como un rol concreto, busca su email:
  ```sql
  -- contra dev
  select u.nombre, u.email, r.nombre as rol
  from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id
  join sgc.roles r on r.id=ur.rol_id order by r.nombre;
  ```

## Trabajar con `--env` (regla 18)

**Ningún script tiene prod como destino por defecto. Sin `--env` no corre.** `--env prod` pide confirmación (o `--yes`).

| Acción | dev | prod (con OK) |
|---|---|---|
| Migración | `node scripts/apply-migration.mjs sql/X.sql --env dev` | `… --env prod --yes` (exige estar en ledger dev) |
| Edge | `node scripts/deploy-edge.mjs --env dev --slug X` (o `--all`) | `… --env prod --yes` |
| Secret | `node scripts/aplicar-secret.mjs --env dev NOMBRE` | `… --env prod --yes` |
| Excepción directa a prod | — | añadir `--force-prod --motivo "…"` (queda registrado en el ledger) |
| Comparar esquemas | `npm run verify:entornos` (prod↔dev, debe dar 0) | |
| Sembrar dev | `node scripts/seed-dev.mjs --env dev [--refrescar]` | (jamás a prod) |
| Config por entorno | `node scripts/set-config-entorno.mjs --env dev` | `… --env prod` (post-paso de la migración de crons) |
| Web local → dev | `npm run env:dev` (genera `environment.ts`) luego `npm start` | `npm run env:prod` |
| Build | `npm run build:dev` | `npm run build:prod` |

El **ledger** (`sgc.migraciones_aplicadas`, `sgc.edges_desplegadas`, `sgc.secrets_aplicados`) vive en **ambos** proyectos. `apply-migration/deploy-edge/aplicar-secret --env prod` consultan el ledger de **dev** y **rechazan** lo que no haya pasado por ahí (salvo `--force-prod`).

## Secrets (por nombre; los valores NUNCA en repo)

Edge (Deno.env): `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` (auto), `ENTORNO` (`dev`/`prod`), `INFRA/WEATHER/CRONOGRAMA/WHATSAPP_ASSISTANT_SYNC_SECRET`, `NOTIFICATIONS_FROM_EMAIL`, `NOTIF_REDIRECT_TO` (dev), `INFRA_ALERT_EMAILS`, `APP_URL`, `WEB_URL`, `PUSH_ALLOWLIST` (dev vacío), `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`, `FCM_SERVICE_ACCOUNT_JSON`.
Vault (dev): `infra_sync_secret`, `weather_sync_secret`, `cronograma_sync_secret`, `resend_api_key`.
Los sync-secrets de dev son **distintos** a prod. En dev, `FCM_SERVICE_ACCOUNT_JSON` y `ASSISTANT_MODEL` no se setean (push apagado; assistant usa el fallback del código).

## Crons por entorno

Ningún cron ni función escribe el ref del proyecto. La URL base de las edges sale de `sgc.config_entorno.edge_base_url` vía `sgc.edge_url(slug)`; el secreto de `sgc.sync_secret()` lo lee del Vault local. Tras aplicar la migración de crons en un entorno, corre `set-config-entorno.mjs --env <env>`. Ver `docs/CRONS.md`.

## Flujo de trabajo (obligatorio)

1. Trabaja en `feature/*`.
2. Aplica migraciones/edges a **dev** (`--env dev`) y **pruébalas** en `dev.sgcconstructorasd.com`.
3. Merge `feature/*` → **`dev`** → Vercel construye dev automáticamente. Avisa: *"está en dev, versión X"*.
4. Xaviel prueba en dev.
5. Con OK: PR **`dev → main`** (usa la plantilla) → la Action `pr-main` verifica build + regla 18 → merge → Vercel prod.
6. `main` está protegida (PR obligatorio); Xaviel puede saltarla (`enforce_admins:false`).

### Hotfix directo a prod (solo Xaviel)
`node scripts/apply-migration.mjs sql/X.sql --env prod --force-prod --motivo "hotfix …" --yes` — queda en el ledger como `forzada=true, aplicada_por='xaviel', motivo`.

## Pasos físicos (solo Xaviel — nadie más puede)

- **Vercel (web):** proyecto `sgc` → Git: marcar `dev` como *Preview branch* · Domains → añadir `dev.sgcconstructorasd.com` y asignarlo a la rama `dev` · Environment Variables → *Preview*: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` = **dev** (para `registrar-version-web`).
- **DNS:** `CNAME dev → cname.vercel-dns.com` (y `app-dev` para el hijo).
- **GitHub → Settings → Secrets and variables → Actions:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV` (para la Action `pr-main`).
- **Google Cloud:** restringir el referrer de `GOOGLE_MAPS_API_KEY` a `dev.`/`app-dev.` (o cuota separada).
- **App (hijo):** ver PROMPT-59 (flavor `.dev`, `app-dev.`).

## Refrescar el seed de dev

`node scripts/seed-dev.mjs --env dev --refrescar` (borra operación y recarga; catálogos por upsert). Opcional semanal (Windows): `schtasks` domingo 3:00 AM → `npm run seed:dev`.

## Rollback

- **Todo dev:** el proyecto `sgc-dev` se pausa/borra sin tocar prod.
- **Ledger / config_entorno:** aditivos; dejarlos no cambia comportamiento.
- **Crons:** la migración anterior de cada job sigue en `sql/`; `cron.schedule` hace upsert.
- **Scripts / código:** `git revert`.
- **Protección de `main`:** `gh api -X DELETE repos/techcsd/SGC/branches/main/protection`.
