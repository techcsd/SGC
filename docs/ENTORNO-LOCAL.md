# Entorno local — solo webapp, backends remotos

Decisión (2026-10-23): **no se monta Supabase ni Odoo en local** (consumía demasiado disco/RAM en Colima y
`sql/` no reproduce el esquema base: faltan `sgc.usuarios`, `sgc.audit_log`… que nacieron antes del historial).
Se corre solo `ng serve` y se apunta a los backends remotos. Odoo se prueba a través de la Edge Function
`odoo-api` desplegada en **dev** (`--env dev`, BU1), nunca con una instancia local.

## Cambiar de base

| Target | Comando | Qué hace |
|---|---|---|
| dev (sgc-dev, staging) | `npm run env:dev-file && npm start` | URL/anon de `src/environments/environment.dev.ts` (públicas). Plantilla `.env.dev.example` para sobreescribir. |
| prod **solo lectura** | `npm run env:prod-ro -- --yes-prod`, luego en otra terminal `npm run proxy:prod-ro`, luego `npm start` | La app habla con `127.0.0.1:54999`; el proxy deja pasar GET/HEAD y solo `POST /auth/v1/token\|logout`; todo lo demás (rest/rpc/storage/functions POST…, websockets) responde 403. Muestra un aviso rojo y exige `--yes-prod`. |

`npm run env:dev` / `env:prod` (originales, leen `.env.local`) no cambian. **No uses `env:prod` para pruebas** (escritura real).
Los `.env.<target>` reales están gitignored; solo las plantillas `.env.*.example` se versionan. Nunca hay ref de prod
hardcodeado: el proxy lo lee de `environment.prod.ts`.

## Límites del modo prod-ro
Login real contra prod (escribe sesión en auth). RPC que escriben o leen vía POST fallan con 403, y Realtime
(Mensajería, badges en vivo) no funciona. Para probar escrituras usa dev.

## Limpieza
`rm -rf node_modules src/environments/environment.ts` (se regeneran con `npm ci` / `npm run env:*`).
