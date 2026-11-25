# Agente Ingeniero — runner, guardianes y promoción (EA3 · F6/F7/F8)

Estado: **código listo, INERTE**. Ningún workflow hace nada hasta que Xaviel cargue los secrets y Environments de la sección 3.
La prueba extremo a extremo real en un repo de prueba **no se pudo hacer** (no hay secrets). Lo que sí se probó: ver «Qué está verificado».
El contrato de datos (RPC, estados, tablas) está en [`AGENTES-INGENIERO.md`](./AGENTES-INGENIERO.md) § «Contrato RPC»; aquí solo se documenta el lado GitHub.

## 1. Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Runner | `.github/workflows/agente-ingeniero.yml` | Reutilizable (`workflow_call`) + `repository_dispatch` (`agente-ingeniero`, payload `{tarea_id, repo}`) + `workflow_dispatch`. Corre `scripts/guardianes/ciclo.sh` |
| Guardianes | `.github/workflows/agente-guardian.yml` | Jobs `ci-agente`, `g1-determinista`, `g2-guardian` sobre PR con etiqueta `agente` o rama `agente/**` / `agente-prod/**` |
| Promoción | `.github/workflows/agente-promocion.yml` | Jobs `humo-dev` y `a-produccion` (incluye verificación y reversión automática) |
| Lógica testeable | `scripts/guardianes/lib/*.mjs` | zona protegida, secretos, SQL aditivo, service role en cliente, tamaño de diff, zona roja, veredicto G2, prompt encapsulado, decisiones de promoción/reversión |
| Prompts | `scripts/guardianes/prompts/*.md` | `ingeniero-analisis`, `ingeniero-codigo`, `guardian` (el Guardián usa OTRO prompt) |
| Zona roja | `scripts/guardianes/zona-roja.json` | categorías (rutas + contenido) |
| Simulación | `scripts/guardianes/simular.mjs` | cadena completa con diffs sembrados, sin red |
| Propuesta de protección | `.github/branch-protection-dev.json`, `.github/branch-protection-main.json` | NO aplicada; la aplica Xaviel (sección 6) |

### Flujo

```
despachador (edge) --repository_dispatch {tarea_id, repo}--> agente-ingeniero
  1 analizar (solo lectura; ¿se reproduce? ¿ya arreglado en dev? ¿repetido?)  -> estado analizando
  2 plan escrito en la tarea                                                   -> plan_listo
     decisión propuesta / no_reproduce / ya_arreglado / duplicado / > topes    -> propuesta | rechazada   (NO escribe código)
  3 cambio mínimo + prueba que falla antes y pasa después                      -> en_codigo
  4 build + tests (sin secrets) + G1 local; si G1 dice «diff grande» -> propuesta
  5 rama agente/<tarea>-<slug> -> PR a dev (etiqueta agente, plantilla: motivo, plan, archivos, cómo se probó, zona roja)  -> en_revision
  6 agente-guardian: ci-agente + g1-determinista + g2-guardian (veredicto JSON como comentario con sha)
       rechazado -> el Ingeniero corrige con los motivos (máx. max_intentos) -> luego necesita_humano + etiqueta necesita-humano
       aprobado  -> migraciones ADITIVAS a dev (no en zona roja) -> merge a dev                                            -> en_dev
  7 agente-promocion (PR mergeado en dev): humo dev (Vercel READY + health + Playwright) -> decidir
       zona roja / auto_prod apagado / pausa / tope diario / humo falló -> se queda en dev
       todo OK -> rama agente-prod/<tarea> (cherry-pick sobre main) -> PR a main -> G1+G2 otra vez + pr-main
               -> migraciones aditivas a prod -> merge -> Vercel -> verificación (health, smoke prod, errores 10 min vs base) -> en_prod
               -> falla: git revert + PR agente-revert (merge de emergencia), tarea revertida, evento apagar_auto_prod + aviso_xaviel, job ROJO
```

Desvío consciente respecto del brief: la promoción **no** abre el PR `dev → main` completo sino un PR a `main` con **solo el commit del agente** (cherry-pick). Un `dev → main` completo arrastraría trabajo humano de dev aún sin liberar a prod. Si el commit no aplica limpio sobre `main`, la tarea pasa a `necesita_humano`.

## 2. Seguridad (cómo se hace cumplir, no cómo se pide)

- **Zona protegida** (`G1`, rechazo automático): `.github/workflows/agente-*.yml`, `scripts/guardianes/**`, `.claude/**`, `CLAUDE.md`, `sql/_reversa/**`, `.github/branch-protection-*.json`. Además el runner y los guardianes **se ejecutan desde una copia confiable de `main`** (checkout aparte, fuera del workspace, solo lectura): el agente no puede cambiar su propia guardia ni sus prompts dentro de su rama. Los jobs `g1`/`g2` usan `pull_request_target`: el código viene de la rama base y el PR entra solo como datos (`git diff`).
- **Inyección de prompt:** el reporte, el cuerpo del PR, el diff, el plan y los motivos entran como DATO con delimitador de nonce aleatorio + aviso explícito de no obedecerlo (`lib/prompt.mjs`, probado). Aun así, lo que el agente haga fuera de lo permitido lo para G1, no el prompt.
- **Entorno mínimo para Claude:** se invoca con `env -i` y solo `ANTHROPIC_API_KEY`. Nunca ve la service role de dev ni el PAT de GitHub. El token de git se pasa por `-c http.extraheader` por comando (no queda en `.git/config`).
- **Build y tests fuera de Claude**, sin ningún secret en el entorno. `package.json`/lockfile son zona roja (un script de build editado sería una vía de exfiltración).
- **Permisos mínimos:** `permissions: contents: read` en el runner (el push/PR lo hace el PAT, no `GITHUB_TOKEN`); el Guardián tiene `contents: read` + `pull-requests: write` **solo para comentar** (sin push, y no llama a la API de aprobar reviews); `ci-agente` corre sin secrets.
- **Herramientas del agente:** Fase 1 solo lectura (`Read, Glob, Grep, graphify, git log/show/diff`); Fase 2 agrega `Write/Edit` y exactamente `build`, `test`, `node --test`. Sin `WebFetch`/`WebSearch`, sin `curl`.
- **CERO service role de prod** en el Ingeniero. Supabase: el runner usa DEV. Prod solo se toca en `a-produccion` (Environment `agentes-prod`) y solo `apply-migration --env prod --yes` de migraciones **aditivas** que ya estén en el ledger de dev (el script rechaza lo demás; nunca `--force-prod`).
- **Red permitida** (lista para `harden-runner`; arranca en `audit`, pasar a `block` tras una corrida limpia y fijar la acción por SHA): `github.com`, `api.github.com`, `codeload.github.com`, `objects.githubusercontent.com`, `registry.npmjs.org`, `api.anthropic.com`, `api.supabase.com`, `*.supabase.co` (solo dev), `api.vercel.com` (solo lectura). Playwright en promoción además necesita `cdn.playwright.dev` / `playwright.azureedge.net` al instalar Chromium.
- **Claude Code fijado** en `2.1.331` (`CLAUDE_CODE_VERSION`). Subirlo = PR revisado por humano.

## 3. Lo que debe cargar Xaviel (pasos físicos)

Todo en GitHub → Settings del repo `techcsd/SGC` (y los mismos nombres en csd-app si usa el runner).

**Environments**
- `agentes-dev` (sin revisores requeridos).
- `agentes-prod` (opcional pero recomendado: restringir a rama `main`/`dev` y, si quieres un freno humano extra, un revisor requerido —eso **apaga** la autonomía de prod).

**Secrets de `agentes-dev`** (solo nombres; nunca pegar valores en chat)
| Nombre | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Code. Recomendado: una key **dedicada** con tope de gasto en la consola de Anthropic |
| `SUPABASE_URL_DEV` | URL del proyecto dev (`https://fzfrnrvndzrjwyvdpkgg.supabase.co`) — para las RPC `ing_*` |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Las RPC del contrato son «solo `service_role`» y viven en dev. Es la service role **de dev**, nunca la de prod |
| `AGENTE_INGENIERO_GITHUB_TOKEN` | PAT fine-grained de una cuenta **bot** (no la tuya): *Contents RW, Pull requests RW, Issues RW (etiquetas), Metadata R*; **sin** permiso *Workflows*; limitado a los repos SGC (y csd-app) |
| `SUPABASE_CSD_CONSTRUCTORA_TOKEN` (opcional) | Token de gestión para `apply-migration --env dev`. Ojo: los tokens de Supabase son **de cuenta, no de proyecto** → usar una cuenta/miembro con acceso **solo** al proyecto dev |
| `SUPABASE_PROJECT_REF_DEV` (opcional) | ref del proyecto dev (`fzfrnrvndzrjwyvdpkgg`) |
| `VERCEL_TOKEN_AGENTES` (opcional) | Token de Vercel limitado al proyecto, solo lectura de despliegues |

**Secrets de `agentes-prod`**: `AGENTE_PROMOCION_GITHUB_TOKEN` (mismo tipo de PAT bot, puede mergear a `main`), `SUPABASE_URL_DEV` y `SUPABASE_SERVICE_ROLE_KEY_DEV` (**los mismos de dev**; las RPC `ing_*` están en dev y un Environment no hereda secrets de otro), `SUPABASE_CSD_CONSTRUCTORA_TOKEN` + `SUPABASE_PROJECT_REF_PROD` (migraciones aditivas a prod; si no se cargan, las tareas con migración se detienen en dev), `VERCEL_TOKEN_AGENTES`, `ERRORES_CONTEO_TOKEN` (si aplica).

**Variables (no secretas)**: `AGENTES_URL_DEV` (default `https://dev.sgcconstructorasd.com`), `AGENTES_URL_PROD` (default `https://sgcconstructorasd.com`), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `ERRORES_CONTEO_URL`.

**Otros pasos**
1. Crear la cuenta bot de GitHub con rol *write* (no admin) en los repos.
2. Settings → Actions → General: permitir que otros repos del org usen los workflows reutilizables de SGC (para csd-app).
3. Aplicar la protección de ramas (sección 6).
4. Promover `scripts/guardianes/**` y estos workflows a `main` (el runner lee los guardianes de `main`; hasta entonces no corre).
5. Decidir la fuente de «errores nuevos en 10 min» (sección 7, pendiente).

## 4. Contrato con EA3-A (lo que este lado asume)

RPC (solo `service_role`, esquema `sgc`, vía PostgREST `Content-Profile: sgc`): `ing_tarea_leer(p_id)`, `ing_tarea_actualizar(p_id, p_estado, p_patch)`, `ing_evento_registrar(p_tarea, p_tipo, p_detalle, p_costo_usd)`, `ing_config_leer()`, `ing_zona_roja_crear_aprobacion(p_tarea, p_motivo)`. `rpc.mjs` rechaza cualquier otro nombre.

Campos de `ing_tarea_leer` que el runner lee (con respaldos): `estado`, `tipo`, `titulo`, `reporte` (o `descripcion`/`texto`), `intentos`, `gasto_ia_hoy_usd` (o `gasto_hoy_usd`). Si no existen, el runner degrada (sin tope de gasto por tarea, `intentos=0`). **EA3-A debe confirmar o ajustar esos nombres.**

`p_patch` que escribe el runner: `plan`, `borrador_respuesta`, `decision_analisis`, `intentos`, `pr_url`, `rama`, `zona_roja`, `guardian`, `requiere_ok_humano`, `merge`, `merge_prod`, `motivo`, `motivo_reversion`, `revert_automatico`.
Tipos de evento que registra: `analisis_inicio/fin`, `codigo_inicio/fin`, `g1_rechazo`, `guardian_veredicto`, `guardian_rechazo`, `migracion_dev`, `merge_dev`, `humo_dev`, `decision_promocion`, `prod_verificado`, `presupuesto_agotado`, `pausa_total`, `necesita_humano`, `apagar_auto_prod`, `aviso_xaviel`.

**Hueco del contrato (no inventado):** no existe una RPC para **apagar `agentes_auto_prod`**. El workflow registra el evento `apagar_auto_prod` y `aviso_xaviel`; EA3-A debe hacer que `ing_evento_registrar` con ese tipo apague el interruptor (o agregar una RPC dedicada y avisarme el nombre). Mientras tanto, la reversión sí ocurre y deja la tarea `revertida` y el job en rojo, pero **el interruptor no se apaga solo**.

## 5. Llamador para csd-app (plantilla; escribirla en el repo de la app)

```yaml
# csd-app/.github/workflows/agente-ingeniero.yml
name: agente-ingeniero
on:
  repository_dispatch:
    types: [agente-ingeniero]
  workflow_dispatch:
    inputs:
      tarea_id: { required: true }
jobs:
  ingeniero:
    if: github.event_name == 'workflow_dispatch' || github.event.client_payload.repo == github.repository
    uses: techcsd/SGC/.github/workflows/agente-ingeniero.yml@main
    with:
      tarea_id: ${{ github.event.inputs.tarea_id || github.event.client_payload.tarea_id }}
      repo_guardianes: techcsd/SGC   # los guardianes viven solo en SGC
      ref_guardianes: main
      rama_base: dev
      build_cmd: npm run build       # ajustar al build real de la app
      test_cmd: npm test -- --watch=false   # ajustar
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      SUPABASE_URL_DEV: ${{ secrets.SUPABASE_URL_DEV }}
      SUPABASE_SERVICE_ROLE_KEY_DEV: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY_DEV }}
      AGENTE_INGENIERO_GITHUB_TOKEN: ${{ secrets.AGENTE_INGENIERO_GITHUB_TOKEN }}
```

Notas: (a) el PAT debe poder leer **SGC** (copia confiable de guardianes) y escribir en csd-app; (b) el job usa `environment: agentes-dev` resuelto en el repo llamador: crear ese Environment allí; (c) **pendiente PROMPT-157:** el `agente-guardian.yml` de csd-app (jobs `ci-agente`, `g1-determinista`, `g2-guardian`) debe ser una copia adaptada que haga checkout de `techcsd/SGC@main` para `scripts/guardianes`; no existe todavía; (d) csd-app **no** lleva `agente-promocion.yml`: la app nativa nunca se publica sola, y cualquier cambio de APK/AAB/tiendas es zona roja.

## 6. Protección de ramas (propuesta, no aplicada)

`.github/branch-protection-dev.json` y `.github/branch-protection-main.json` son el cuerpo de `PUT /repos/{owner}/{repo}/branches/{rama}/protection`:

```
gh api -X PUT repos/techcsd/SGC/branches/dev/protection  --input .github/branch-protection-dev.json
gh api -X PUT repos/techcsd/SGC/branches/main/protection --input .github/branch-protection-main.json
```

- `dev`: exige `ci-agente`, `g1-determinista`, `g2-guardian`. Para PR que **no** son del agente esos jobs se saltan (`skipped` cuenta como verde), así que Xaviel y Claude Code siguen igual.
- `main`: exige además `build-and-ledger` (el `pr-main` existente), más `require_code_owner_reviews` + `require_last_push_approval`.
- **El bot no puede aprobarse a sí mismo**, por capas: (1) GitHub no deja aprobar el propio PR; (2) el Guardián solo comenta y falla/pasa su job, nunca llama a la API de reviews; (3) cuenta bot distinta de las humanas y sin rol admin; (4) crear `.github/CODEOWNERS` con la zona protegida a nombre de Xaviel (`/.github/workflows/agente-*.yml`, `/scripts/guardianes/`, `/.claude/`, `/CLAUDE.md`, `/sql/_reversa/`, `/.github/branch-protection-*.json`) → con `require_code_owner_reviews`, esos archivos exigen su aprobación aunque G1 fallara.
- Tradeoff: con `required_approving_review_count: 0` el auto-prod es posible; si subes a 1, **se apaga el auto-prod** (el bot no puede aprobar su PR). La reversión de emergencia usa `--admin` (si la cuenta bot no es admin cae a `--auto`, que espera los checks y requiere «Allow auto-merge» activo en el repo).
- Esta protección pisa la regla existente de `main`; revisarla antes de aplicar. (El repo no trae hoy ningún `branch-protection-*.json` versionado.)

## 7. Qué NO está resuelto / no verificado

- Ningún workflow corrió en GitHub (sin secrets, sin runner). Validado: YAML parsea y los 30 bloques `run:` pasan `bash -n`. No se pudo correr `actionlint`/`shellcheck` (no instalados).
- `anthropics/claude-code-action` no se usó: se invoca `@anthropic-ai/claude-code@2.1.331 -p` por CLI (permite `env -i` y leer `total_cost_usd`). Flags `--allowedTools/--disallowedTools/--output-format json/--max-turns` tomados de la documentación del CLI y del patrón de `agente-escriba.yml`; **no ejecutados aquí**.
- `step-security/harden-runner@v2` va por tag, no por SHA (no pude verificar el SHA). Fijarlo al activar `block`.
- **Verificación de errores en prod (10 min vs línea base):** necesita una fuente de solo lectura que no sea la service role de prod. `errores.mjs` espera un endpoint `ERRORES_CONTEO_URL` → `{ultimos_10min, previos_10min}` (p. ej. una edge function de conteo). **No existe**: sin ella la verificación solo usa health + smoke y lo deja anotado. Decisión pendiente de Xaviel/EA3-A.
- Rollback por Vercel (promover despliegue anterior) no se usa: el token es de solo lectura; se revierte por git. Una migración aditiva ya aplicada a prod **no** se revierte sola (las migraciones aditivas son compatibles con el código anterior; la reversa `sql/_reversa/` es manual).
- El «humo» Playwright es mínimo y **sin login** (`qa/e2e/humo-agentes.spec.ts`: la app carga, sin errores de página, ruta protegida no abre). No ejercita flujos con sesión (las credenciales QA no están en CI).
- Contar «PR a prod hoy» usa búsqueda de PR mergeados con etiqueta `agente-prod` desde las 00:00 de Santo Domingo; no depende de la config.
- La verificación «prueba que falla antes y pasa después» la exige el prompt, no la comprueba G1 (G2 la juzga leyendo el diff).
- Para csd-app: llamador documentado, no probado; falta su `agente-guardian.yml` (PROMPT-157).
- CI13: ver nota en `PARIDAD.md` — revisar `docs/DATOS-Y-TERCEROS.md` (Anthropic ya figura; GitHub Actions/Vercel son terceros del proceso de desarrollo, no de datos de usuarios).

## 8. Comandos

```
node --test "scripts/guardianes/test/*.test.mjs"     # pruebas de los guardianes
node scripts/guardianes/simular.mjs                   # cadena completa con diffs sembrados
node scripts/guardianes/g1.mjs --base origin/dev --head HEAD   # G1 sobre tu rama (exit 0 aprobado, 1 rechazado, 2 propuesta)
```
