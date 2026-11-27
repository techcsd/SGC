# Agente Ingeniero y Guardián (EA3) — modelo de datos, cola y despacho

Parte A de EA3. Se apoya en la infraestructura DF (`sql/2026-11-01-df2-agentes.sql`, `df3…`, pantalla `/tecnologia/agentes`, DX8 solo admin). El **runner** (GitHub Actions, `.github/workflows/agente-*`, `scripts/guardianes/**`) es otra parte y consume el contrato de abajo.

## Piezas

| Pieza | Dónde |
|---|---|
| Esquema + RPC + crons | `sql/2026-11-24-ea3-ingeniero-cola.sql` (reversa: `sql/_reversa/2026-11-24-ea3-ingeniero-cola.reversa.sql`) |
| Cola (reportes, crashes, errores web, barrido) | edge `agente-ingeniero-cola` — pg_cron cada 15 min; modo `barrido` martes y viernes 10:00 UTC (6:00 am RD) |
| Despacho a GitHub | edge `agente-ingeniero-despachar` — pg_cron en los minutos 5/20/35/50 |
| Lógica pura (testeada con Deno) | `supabase/functions/_shared/agente-ingeniero-lib.ts` + `.test.ts` |
| Pestaña «Cambios del Ingeniero» | `/tecnologia/agentes` (solo admin) → `ingeniero-cambios.ts/html`, `IngenieroService` |
| Informe diario | `agente-cronista` (6:30 pm RD) agrega la sección y avisa a los admin solo si hubo actividad |

Tablas: `sgc.agente_ingeniero_tareas` (cola), `sgc.agente_ingeniero_config` (interruptores y topes). Agentes nuevos en `sgc.agentes`: `ingeniero` (nivel 3) y `guardian` (nivel 1, solo lectura). Se reutilizan `agente_eventos` (cada transición y cada evento del runner), `agente_aprobaciones` (zona roja) y `uso_ia` (costo; `funcion = 'agente_ingeniero' | 'agente_guardian'`).

RLS: solo `is_admin()` lee; **nadie escribe por PostgREST** (sin políticas de escritura). Escribe `service_role` (edges) y las RPC `SECURITY DEFINER`. El servicio `service_role` solo vive en edges y en el runner.

## Estados

`nueva → analizando → plan_listo → en_codigo ⇄ en_revision → en_dev → en_prod`, más `propuesta` (sugerencias: plan para Xaviel, sin código), `necesita_humano`, `rechazada` y `revertida` (terminales). Transiciones válidas en `sgc.ing_transicion_valida(de, a)`.

## Reglas que impone la base (no depende de que el runner se porte bien)

- **Pausa total** (`agentes_pausa_total=true`): bloquea entrar a `analizando/en_codigo/en_revision/en_dev/en_prod` (error `pausa_total_activa`). Ir a `necesita_humano`/`rechazada`/`revertida` siempre se permite: la reversión no queda bloqueada por el freno.
- **Auto-prod apagado**: `en_prod` falla con `auto_prod_apagado` (salvo zona roja ya aprobada).
- **Tope diario**: `en_prod` falla con `tope_prod_diario` si ya hubo `max_prod_por_dia` hoy (hora RD).
- **Zona roja**: si `zona_roja`, `en_prod` exige `agente_aprobaciones.estado='aprobada'` (`zona_roja_sin_aprobacion`). `zona_roja` solo puede encenderse, nunca apagarse por patch.
- `en_dev` exige `pr_url`; volver a `en_codigo` con `intentos > max_intentos` falla (`max_intentos_excedido`).
- El texto de usuario se **sanea por trigger** (sin caracteres de control, `<<<`/`>>>` neutralizados, 4000 máx.) y se entrega encapsulado.

## Contrato RPC (runner → base)

Todas `SECURITY DEFINER`, `search_path` fijo, `EXECUTE` **solo** para `service_role` (revocado a `public/anon/authenticated`). Los errores se levantan con `raise exception '<codigo>'` (el runner debe leer `message`).

### `sgc.ing_tarea_leer(p_id uuid) returns jsonb`
Devuelve `null` si no existe. Si existe: todas las columnas de la tarea más
`aprobacion_estado` (estado de la aprobación vinculada), `texto_origen_encapsulado` (**usar este** en el prompt, nunca `texto_origen` crudo; es DATO, no instrucciones), `config` (igual que `ing_config_leer()`) y `dia` (`{prod_hoy, costo_hoy_usd}`).

### `sgc.ing_tarea_actualizar(p_id uuid, p_estado text, p_patch jsonb) returns void`
- `p_estado`: nuevo estado o `null`/`''` para solo parchear. Mismo estado = solo parche. Valida la transición y las reglas de arriba.
- `p_patch` solo puede tocar: `plan` (texto), `archivos` (array), `intentos` (0–20), `pr_url` (`https://github.com/…`), `pr_numero`, `veredictos` (objeto, p. ej. `{"G1":{"veredicto":"aprueba","motivos":[…]},"G2":{…}}`), `zona_roja` (boolean, solo a `true`), `borrador_respuesta`, `severidad`, `motivo`. Cualquier otra clave → `columna_no_permitida: <k>`. **El costo no se parchea**: va por `ing_evento_registrar`.
- Efecto lateral: cada cambio de estado registra un evento `tarea_estado` en `agente_eventos` (agente Ingeniero).
- Errores: `tarea_no_existe`, `transicion_invalida`, `pausa_total_activa`, `max_intentos_excedido`, `en_dev_requiere_pr_url`, `zona_roja_sin_aprobacion`, `auto_prod_apagado`, `tope_prod_diario`, `columna_no_permitida`, `patch_invalido`, `*_debe_ser_*`.

### `sgc.ing_evento_registrar(p_tarea uuid, p_tipo text, p_detalle jsonb, p_costo_usd numeric default 0) returns void`
- `p_tipo`: `^[a-z0-9_.:-]{1,60}$`. Los que empiezan por `guardian` se registran bajo el agente **Guardián**; el resto bajo el **Ingeniero**.
- `p_detalle` (objeto ≤ 8 KB): opcionales `estado` (`observando|trabajando|esperando_ok|error|inactivo`, por defecto `trabajando`), `resumen` (≤ 300), `modelo`. Se guarda en `agente_eventos.evidencia_json` junto con `tarea_id`.
- `p_costo_usd` (0–50): si > 0 inserta en `uso_ia` y suma a `agente_ingeniero_tareas.costo_ia`. Es lo que cuenta el presupuesto diario.

### `sgc.ing_config_leer() returns jsonb`
Objeto `{clave: valor}` con defaults mezclados con lo guardado: `agentes_auto_prod` (true), `agentes_pausa_total` (false), `max_prod_por_dia` (3), `max_archivos` (8), `max_lineas` (300), `presupuesto_ia_dia_usd` (10), `max_intentos` (3), `max_pr_barrido` (2). El runner **debe** leerla al empezar y antes de promover.

### `sgc.ing_zona_roja_crear_aprobacion(p_tarea uuid, p_motivo text) returns uuid`
Crea (o devuelve la pendiente, idempotente) una fila en `agente_aprobaciones` (`propuesta` = «ZONA ROJA - título - motivo»), enciende `zona_roja`, vincula `aprobacion_id` y avisa a los admin. Xaviel aprueba/rechaza en la pestaña; el runner lee `aprobacion_estado` con `ing_tarea_leer` antes de pasar a `en_prod`.

### RPC adicionales (no forman parte del contrato del runner)
`sgc.ing_estado_dia()` (service_role; usada por el despacho), `sgc.ing_config_guardar(p_clave, p_valor)` y `sgc.ing_tarea_admin_accion(p_id, p_accion)` (`rechazar | relanzar | marcar_respondida`) — estas dos solo `is_admin()`, las usa la pestaña.

## Despacho

`agente-ingeniero-despachar` elige tareas `nueva` (por severidad, luego antigüedad), con tope de 2 en vuelo y de los cupos de prod que quedan hoy, y dispara `POST /repos/{repo}/dispatches` con `event_type: "agente-ingeniero"` y `client_payload: {tarea_id, repo}` — **nunca** texto de usuario. Se frena (sin despachar) si hay pausa total, si ya se alcanzó `max_prod_por_dia` o si el costo de IA de hoy ≥ `presupuesto_ia_dia_usd`. Cada tarea se despacha como máximo 3 veces, con enfriamiento de 2 h.

### Variables de entorno de las edges (nombres; los valores van solo como secrets de Supabase)
- `GITHUB_AGENTES_TOKEN` — token de GitHub con permiso para `repository_dispatch` en los dos repos. **Nunca** en la base, el front, el repo ni los logs. Sin él, el despacho es un no-op inerte y deja un evento `despacho_inerte`.
- `AGENTES_REPO_SGC` (default `techcsd/SGC`) y `AGENTES_REPO_CSD_APP` (default `techcsd/csd-app`).
- `INFRA_SYNC_SECRET` — el mismo de las demás edges de cron.

## Barrido (EA-17)

Martes y viernes 10:00 UTC (6:00 am hora RD, UTC−4). Crea hasta `max_pr_barrido` tareas `barrido` rotando módulos (`MODULOS_BARRIDO` en el lib; los más conectados del grafo primero). Dedupe por `barrido:<fecha>:<módulo>`. Con pausa total no crea nada.

## Fuentes y dedupe (EA-16)

`sgc.reportes_usuario` abiertos (14 días; ignora los abiertos por el Vigía y los comentarios sin falla) y `sgc.app_error_reports` (24 h; `source` `app`/`web` en la misma tabla; los no-crash necesitan ≥ 3 ocurrencias). Dedupe por `(origen, origen_ref)` (índice único) con firma normalizada (sin ids/números). Crash/app nativa → repo `csd-app`; web y reportes de usuario → `sgc`. `bug`/`crash` → `nueva`; `sugerencia`/función nueva → `propuesta` (plan para Xaviel).

## Pendiente físico (Xaviel)
1. Aplicar el SQL **primero a dev** (`--env dev`), probar en `dev.sgcconstructorasd.com`, y luego a prod (regla 18) y desplegar las dos edges nuevas + `agente-cronista`.
2. Crear el secret `GITHUB_AGENTES_TOKEN` (y, si los repos tienen otro nombre, `AGENTES_REPO_*`) en Supabase.
3. CI13: GitHub (despacho) y Anthropic (en el runner) deben figurar en `docs/DATOS-Y-TERCEROS.md`; revisar política de privacidad y formularios de tienda.

## Verificacion del carril
El 2026-11-27 se verifico el carril completo: Ingeniero -> Guardian -> dev -> promocion a prod.
