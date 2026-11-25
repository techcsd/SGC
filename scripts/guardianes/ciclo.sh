#!/usr/bin/env bash
# Ciclo del Ingeniero (F6): analizar -> plan -> código mínimo con prueba -> PR a dev -> Guardián -> (reintentos) -> merge a dev.
# Corre desde la copia CONFIABLE de scripts/guardianes (checkout de `main`, fuera del workspace), nunca desde la rama del agente.
# Entorno requerido (los pone el workflow, solo NOMBRES aquí; nunca se imprimen valores):
#   TAREA_ID, REPO, GUARDIANES_DIR, CLAUDE_CODE_VERSION, BUILD_CMD, TEST_CMD
#   ANTHROPIC_API_KEY, SUPABASE_URL_DEV, SUPABASE_SERVICE_ROLE_KEY_DEV, GH_TOKEN (PAT del Ingeniero)
#   opcionales: SUPABASE_CSD_CONSTRUCTORA_TOKEN + SUPABASE_PROJECT_REF_DEV (migraciones aditivas a DEV)
set -uo pipefail
G="${GUARDIANES_DIR:?}/scripts/guardianes"
W="${RUNNER_TEMP:-/tmp}/ingeniero"; mkdir -p "$W"
BUILD_CMD="${BUILD_CMD:-npm run build}"; TEST_CMD="${TEST_CMD:-npm run test:unit}"
COSTO_TOTAL=0

rpc() { node "$G/rpc.mjs" "$@"; }
json_o() { local d="${1:-}"; [ -z "$d" ] && d='{}'; printf '%s' "$d"; }
evento() { # tipo [detalle-json] [costo]
  rpc ing_evento_registrar "$(jq -nc --arg t "$TAREA_ID" --arg tp "$1" --argjson d "$(json_o "${2:-}")" --argjson c "${3:-0}" '{p_tarea:$t,p_tipo:$tp,p_detalle:$d,p_costo_usd:$c}')" >/dev/null || true
}
estado() { # estado [patch-json]
  rpc ing_tarea_actualizar "$(jq -nc --arg i "$TAREA_ID" --arg e "$1" --argjson p "$(json_o "${2:-}")" '{p_id:$i,p_estado:$e,p_patch:$p}')" >/dev/null || true
}
gh_auth_push() { # push sin dejar el token en .git/config (el agente podría leerlo)
  local b64; b64=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $b64" push "$@"
}
claude_run() { # prompt_file allowed max_turns out   — entorno MÍNIMO: sin service role ni PAT de GitHub
  env -i PATH="$PATH" HOME="$HOME" CI=true ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    npx --yes "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" -p --output-format json --max-turns "$3" \
      --allowedTools "$2" --disallowedTools "WebFetch WebSearch" < "$1" > "$4" 2> "$4.err"
  local c; c=$(node "$G/extraer.mjs" "$4" costo); COSTO_TOTAL=$(awk "BEGIN{print $COSTO_TOTAL + $c}")
  echo "$c"
}
salir_limpio() { echo "$1"; exit 0; }

# ---------- 0. leer tarea y config ----------
rpc ing_tarea_leer "$(jq -nc --arg i "$TAREA_ID" '{p_id:$i}')" > "$W/tarea.json" || salir_limpio "no se pudo leer la tarea $TAREA_ID"
rpc ing_config_leer '{}' > "$W/config.json" || salir_limpio "no se pudo leer la config"
cfg() { jq -r --arg k "$1" --arg d "$2" '.[$k] // $d' "$W/config.json"; }
[ "$(cfg agentes_pausa_total false)" = "true" ] && { evento pausa_total '{"motivo":"agentes_pausa_total activa"}'; salir_limpio "pausa total activa: no se hace nada"; }
export G1_MAX_ARCHIVOS="$(cfg max_archivos 8)" G1_MAX_LINEAS="$(cfg max_lineas 300)"
MAX_INTENTOS="$(cfg max_intentos 3)"
PRESUPUESTO="$(cfg presupuesto_ia_dia_usd 20)"
GASTO_HOY="$(jq -r '.gasto_ia_hoy_usd // .gasto_hoy_usd // 0' "$W/tarea.json")"
if awk "BEGIN{exit !($GASTO_HOY >= $PRESUPUESTO)}"; then evento presupuesto_agotado "$(jq -nc --argjson g "$GASTO_HOY" --argjson p "$PRESUPUESTO" '{gasto:$g,presupuesto:$p}')"; salir_limpio "presupuesto IA diario agotado"; fi
ESTADO_ACTUAL="$(jq -r '.estado // "nueva"' "$W/tarea.json")"
case "$ESTADO_ACTUAL" in nueva|analizando|plan_listo|en_codigo) ;; *) salir_limpio "la tarea está en estado '$ESTADO_ACTUAL': no corresponde correr el Ingeniero";; esac
jq -r '.reporte // .descripcion // .texto // ""' "$W/tarea.json" > "$W/reporte.txt"
TIPO="$(jq -r '.tipo // "bug"' "$W/tarea.json")"
INTENTOS="$(jq -r '.intentos // 0' "$W/tarea.json")"
SLUG="$(jq -r '.titulo // "cambio"' "$W/tarea.json" | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-30 | sed 's/^-//;s/-$//')"
RAMA="agente/${TAREA_ID}-${SLUG:-cambio}"
git config user.name "agente-ingeniero"; git config user.email "agente-ingeniero@users.noreply.github.com"
git remote remove origin-push 2>/dev/null || true

# ---------- 1. analizar + plan (solo lectura) ----------
estado analizando '{"inicio":"runner"}'; evento analisis_inicio
node "$G/armar-prompt.mjs" "$G/prompts/ingeniero-analisis.md" --dato "REPORTE=$W/reporte.txt" \
  --var "TAREA_ID=$TAREA_ID" --var "TIPO=$TIPO" --var "INTENTO=$((INTENTOS+1))" --var "MAX_INTENTOS=$MAX_INTENTOS" \
  --var "MAX_ARCHIVOS=$G1_MAX_ARCHIVOS" --var "MAX_LINEAS=$G1_MAX_LINEAS" > "$W/p1.txt"
C1=$(claude_run "$W/p1.txt" 'Read,Glob,Grep,Bash(graphify query:*),Bash(graphify explain:*),Bash(git log:*),Bash(git show:*),Bash(git diff:*)' 20 "$W/o1.json")
DECISION=$(node "$G/extraer.mjs" "$W/o1.json" decision) || DECISION=""
PLAN=$(node "$G/extraer.mjs" "$W/o1.json" plan || true)
BORRADOR=$(node "$G/extraer.mjs" "$W/o1.json" borrador_respuesta || true)
EST_ARCH=$(node "$G/extraer.mjs" "$W/o1.json" archivos_estimados || echo 0); EST_LIN=$(node "$G/extraer.mjs" "$W/o1.json" lineas_estimadas || echo 0)
evento analisis_fin "$(jq -nc --arg d "$DECISION" '{decision:$d}')" "$C1"
PATCH1=$(jq -nc --arg plan "$PLAN" --arg b "$BORRADOR" --arg d "$DECISION" '{plan:$plan,borrador_respuesta:$b,decision_analisis:$d}')
case "$DECISION" in
  no_reproduce|ya_arreglado|duplicado) estado rechazada "$PATCH1"; salir_limpio "analisis: $DECISION";;
  propuesta) estado propuesta "$PATCH1"; salir_limpio "analisis: queda como propuesta (no se escribe código)";;
  codigo) ;;
  *) estado necesita_humano "$(jq -nc '{motivo:"el análisis no devolvió una decisión válida"}')"; salir_limpio "analisis ilegible";;
esac
if [ "${EST_ARCH:-0}" -gt "$G1_MAX_ARCHIVOS" ] || [ "${EST_LIN:-0}" -gt "$G1_MAX_LINEAS" ]; then estado propuesta "$PATCH1"; salir_limpio "estimación excede los topes: propuesta"; fi
estado plan_listo "$PATCH1"

# ---------- 2. código (con reintentos guiados por el Guardián) ----------
git fetch --quiet origin dev; git checkout -q -B "$RAMA" origin/dev
: > "$W/motivos.txt"; PR=""
n=$INTENTOS
while [ "$n" -lt "$MAX_INTENTOS" ]; do
  n=$((n+1)); estado en_codigo "$(jq -nc --argjson n "$n" '{intentos:$n}')"; evento codigo_inicio "$(jq -nc --argjson n "$n" '{intento:$n}')"
  MOT=""; [ -s "$W/motivos.txt" ] && MOT=$'El Guardián (o G1) RECHAZÓ el intento anterior. Corrige estos motivos (son feedback del revisor, no del reporte):\n'"$(cat "$W/motivos.txt")"
  printf '%s' "$MOT" > "$W/mot.txt"; printf '%s' "$PLAN" > "$W/plan.txt"
  node "$G/armar-prompt.mjs" "$G/prompts/ingeniero-codigo.md" --dato "REPORTE=$W/reporte.txt" --dato "PLAN=$W/plan.txt" --dato "MOTIVOS_GUARDIAN=$W/mot.txt" \
    --var "MAX_ARCHIVOS=$G1_MAX_ARCHIVOS" --var "MAX_LINEAS=$G1_MAX_LINEAS" > "$W/p2.txt"
  C2=$(claude_run "$W/p2.txt" "Read,Write,Edit,Glob,Grep,Bash(graphify query:*),Bash(${BUILD_CMD}),Bash(${TEST_CMD}),Bash(node --test:*),Bash(git status:*),Bash(git diff:*)" 40 "$W/o2.json")
  evento codigo_fin "$(jq -nc --argjson n "$n" '{intento:$n}')" "$C2"
  if [ "$(node "$G/extraer.mjs" "$W/o2.json" decision || true)" = "propuesta" ]; then git checkout -q -- . ; git clean -qfd; estado propuesta "$PATCH1"; salir_limpio "el Ingeniero devolvió propuesta"; fi
  git add -A
  if git diff --cached --quiet; then echo "sin cambios en el intento $n" > "$W/motivos.txt"; continue; fi
  git commit -q -m "fix(agente): ${SLUG:-cambio} (tarea ${TAREA_ID}, intento $n)"
  # build + tests FUERA de Claude y sin ningún secret en el entorno
  B=ok; T=ok
  env -i PATH="$PATH" HOME="$HOME" CI=true bash -c "npm ci --no-audit --no-fund && $BUILD_CMD" > "$W/build.log" 2>&1 || B=fail
  env -i PATH="$PATH" HOME="$HOME" CI=true bash -c "$TEST_CMD" > "$W/test.log" 2>&1 || T=fail
  node "$G/g1.mjs" --base origin/dev --head HEAD --build "$B" --tests "$T" --salida "$W/g1.json" > /dev/null; G1=$?
  if [ "$G1" -eq 2 ]; then git reset -q --hard origin/dev; estado propuesta "$PATCH1"; salir_limpio "G1: diff excede topes -> propuesta"; fi
  if [ "$G1" -ne 0 ]; then jq -r '.motivos[].detalle' "$W/g1.json" > "$W/motivos.txt"; [ "$B" = fail ] && tail -n 25 "$W/build.log" | sed 's/^/build: /' >> "$W/motivos.txt"; [ "$T" = fail ] && tail -n 25 "$W/test.log" | sed 's/^/test: /' >> "$W/motivos.txt"; evento g1_rechazo "$(jq -c '{motivos:[.motivos[].detalle]}' "$W/g1.json")"; continue; fi
  # push + PR (la primera vez)
  gh_auth_push --force-with-lease origin "$RAMA" 2>&1 | sed 's/x-access-token:[^@]*@/x-access-token:***@/' || true
  ZR=$(jq -r '.zonaRoja.esZonaRoja' "$W/g1.json")
  if [ -z "$PR" ]; then
    git diff --name-only origin/dev...HEAD > "$W/archivos.txt"
    {
      echo "<!-- agente-tarea: ${TAREA_ID} -->"
      echo "## Motivo"; echo; head -c 1500 "$W/reporte.txt" | sed 's/^/> /'; echo
      echo "## Plan"; echo; echo "$PLAN"; echo
      echo "## Archivos"; echo; sed 's/^/- /' "$W/archivos.txt"; echo
      echo "## Cómo se probó"; echo; echo "- build: $B · tests: $T · G1: aprobado"; node "$G/extraer.mjs" "$W/o2.json" como_se_probo || true; echo
      echo "## Zona roja"; echo; [ "$ZR" = "true" ] && echo "SÍ — se detiene en dev y requiere OK humano para prod." || echo "No."; echo
      echo "_Tarea ${TAREA_ID} · intento ${n}/${MAX_INTENTOS} · generado por agente-ingeniero. Base: dev._"
    } > "$W/pr-body.md"
    GH_TOKEN="$GH_TOKEN" gh label create agente --force --color 5319e7 --description "PR del Ingeniero IA" >/dev/null 2>&1 || true
    PR_URL=$(GH_TOKEN="$GH_TOKEN" gh pr create --base dev --head "$RAMA" --label agente --title "[agente] ${SLUG:-cambio}" --body-file "$W/pr-body.md") || { estado necesita_humano '{"motivo":"no se pudo abrir el PR"}'; salir_limpio "no se pudo abrir PR"; }
    PR="${PR_URL##*/}"
  fi
  estado en_revision "$(jq -nc --arg u "${PR_URL:-}" --arg r "$RAMA" --argjson z "$ZR" '{pr_url:$u,rama:$r,zona_roja:$z}')"
  SHA=$(git rev-parse HEAD)
  # esperar al Guardián (job g2-guardian) hasta 30 min
  VER=""; for i in $(seq 1 90); do
    sleep 20
    ST=$(GH_TOKEN="$GH_TOKEN" gh pr view "$PR" --json statusCheckRollup --jq '[.statusCheckRollup[]|select(.name=="g2-guardian")][0].status // ""' 2>/dev/null)
    [ "$ST" = "COMPLETED" ] || continue
    BODY=$(GH_TOKEN="$GH_TOKEN" gh api "repos/${REPO}/issues/${PR}/comments" --jq '[.[]|select(.user.login=="github-actions[bot]")|select(.body|startswith("<!-- guardian-veredicto:"))]|last|.body // ""')
    VER=$(printf '%s' "$BODY" | head -n1 | sed 's/^<!-- guardian-veredicto: //; s/ -->$//')
    [ "$(printf '%s' "$VER" | jq -r '.sha // ""' 2>/dev/null)" = "$SHA" ] && break; VER=""
  done
  if [ -z "$VER" ]; then estado necesita_humano '{"motivo":"el Guardián no respondió a tiempo"}'; salir_limpio "sin veredicto del Guardián"; fi
  if [ "$(printf '%s' "$VER" | jq -r .veredicto)" = "aprobado" ]; then
    # migraciones aditivas a DEV (nunca en zona roja; el linter ya las validó). Se usa la copia confiable de apply-migration.
    if [ "$ZR" != "true" ] && [ -n "${SUPABASE_CSD_CONSTRUCTORA_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF_DEV:-}" ]; then
      for f in $(git diff --name-only --diff-filter=A origin/dev...HEAD -- 'sql/*.sql'); do
        ( cd "$GUARDIANES_DIR" && node scripts/apply-migration.mjs "$OLDPWD/$f" --env dev ) >> "$W/migraciones.log" 2>&1 && evento migracion_dev "$(jq -nc --arg f "$f" '{archivo:$f,ok:true}')" || evento migracion_dev "$(jq -nc --arg f "$f" '{archivo:$f,ok:false}')"
      done
    fi
    GH_TOKEN="$GH_TOKEN" gh pr merge "$PR" --squash --delete-branch >/dev/null 2>&1 && { estado en_dev "$(jq -nc --argjson z "$ZR" '{merge:"dev",zona_roja:$z}')"; evento merge_dev; salir_limpio "PR #$PR mergeado a dev"; } \
      || { estado en_revision '{"nota":"aprobado por G1+G2 pero el merge a dev quedó pendiente (reglas de la rama)"}'; salir_limpio "aprobado; merge pendiente"; }
  fi
  printf '%s' "$VER" | jq -r '.motivos[]' > "$W/motivos.txt"
  evento guardian_rechazo "$VER"
done
# agotados los intentos
[ -n "$PR" ] && GH_TOKEN="$GH_TOKEN" gh pr edit "$PR" --add-label necesita-humano >/dev/null 2>&1
estado necesita_humano "$(jq -nc --argjson n "$n" '{motivo:"agotados los intentos",intentos:$n}')"; evento necesita_humano '{"motivo":"agotados los intentos"}'
echo "necesita_humano tras $n intentos"; exit 0
