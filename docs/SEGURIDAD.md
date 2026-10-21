# SEGURIDAD — Supabase Security Advisor (`rls_disabled_in_public` y afines)

> Origen: CU2 (fila 269, `CONTEXTO-ACTUALIZACION-54.md`). Supabase mandó avisos
> críticos de seguridad el 13, 17 y 20 de octubre de 2026. Este documento explica
> qué eran, cómo se corrigió y cómo revisar los advisors en cada ronda para que
> no vuelva a pasar desapercibido.

## ⚠️ "público" en el nombre del lint NO significa el esquema `public`

Primera lección de esta ronda: `rls_disabled_in_public` significa **"alcanzable
por el Data API"**, no "está en el esquema llamado `public`". El Data API expone
varios esquemas a la vez (confirmado con la Management API en dev y prod):

```
db_schema = "public, graphql_public, sgc, web"
```

Una tabla de `sgc` sin RLS es **igual de pública** para ese lint que una tabla en
el esquema `public`. La primera pasada de esta ronda (y la auditoría de CT9 de la
ronda anterior) solo miró el esquema llamado `public` literalmente — encontró y
bloqueó `n8n_chat_histories` ahí, pero **no vio `sgc.auditoria_frases`**, que el
motor real de advisors sí marca como `ERROR` en dev y prod, porque nunca se le
ocurrió mirar dentro de `sgc` mismo. Se encontró al consultar el endpoint
autoritativo de Supabase directamente (ver abajo) en vez de confiar solo en una
heurística propia — **la lección que queda: siempre confirmar contra el motor
real de advisors, no solo contra una interpretación del nombre del esquema.**

## Hallazgo 1 — `public.n8n_chat_histories` (cerrado, ronda CT/CT9)

Tabla del stack n8n/WhatsApp (ver skill `ws-ops`) que se conecta directo a este
mismo Postgres, ajena al SGC — ninguna migración de este repo la crea. Bloqueada
en `sql/2026-10-20-ct9-bloquear-n8n-chat-histories.sql` (RLS activa sin políticas
+ revoke a anon/authenticated/public, en dev y prod). Esto también resolvió el
aviso `sensitive_columns_exposed` de dev (confirmado: ya no aparece en el motor
de advisors — era la misma tabla, columna `message jsonb`).

**Causa raíz del cómo llegó a estar expuesta (CU2, auditoría de solo lectura
20-oct-2026):** el esquema `public` tenía `ALTER DEFAULT PRIVILEGES` que
regalaban acceso automático a `anon`/`authenticated` para **cualquier objeto
nuevo** (tabla/función/secuencia) creado por el rol `postgres` — en dev, tablas
nuevas nacían con acceso CRUD completo automático; funciones nuevas nacían con
EXECUTE automático en dev **y** prod; secuencias nuevas nacían con USAGE/SELECT/
UPDATE automático en ambos. Esto es lo que el aviso de Supabase *"Final notice:
new tables in public need grants from October 30"* viene a corregir a nivel de
plataforma — no se esperó esa fecha: se revocó el default ahora mismo (ver
`sql/2026-10-20-cu2-public-default-privileges.sql`, aplicada en dev; **falta el
OK de Xaviel para prod**).

**No se pudo cerrar el default de `supabase_admin`** (el rol que ejecuta las
migraciones vía Management API es `postgres`, que no tiene permiso para alterar
los default privileges de otro rol — `ERROR 42501: permission denied to change
default privileges`). Ese rol es el superusuario interno de Supabase; en la
práctica solo Supabase mismo crea objetos con él. Riesgo residual aceptado y
documentado aquí, no corregible desde este repo.

## Hallazgo 2 — `sgc.auditoria_frases` (🔴 nuevo, encontrado por esta ronda)

**`ERROR rls_disabled_in_public`, EN VIVO en dev Y EN PROD** (confirmado contra
el endpoint real de advisors, no una heurística). La tabla (creada en
`sql/2026-10-16-cq3-auditoria-contexto.sql`, ronda CQ) es un catálogo de frases
en español ("verbo + sustantivo") para armar el feed de auditoría legible — sin
datos de usuarios, sembrada solo por migración, nunca escrita por la app. Tenía
`grant select to authenticated` (necesario: la RPC que la lee,
`sgc.auditoria_frase()`, es `security invoker`, no `definer` — sin el grant
fallaría para cualquier usuario) pero **RLS nunca se activó** → "RLS apagada +
grant directo" es exactamente el patrón que el advisor marca, aunque el
contenido en sí no sea sensible.

**Fix (`sql/2026-10-20-cu2-auditoria-frases-rls.sql`, aplicado en dev):** RLS
activa + una política `for select to authenticated using (true)` que reproduce
el mismo acceso de siempre — cero cambio de comportamiento, confirmado llamando
`sgc.auditoria_frase()` como `authenticated` después del fix (sigue devolviendo
la frase). El advisor ya no muestra `rls_disabled_in_public` en dev tras
aplicar. **Falta aplicar a prod (con el OK de Xaviel) y confirmar que el aviso
desaparece ahí también.**

## Hallazgo 3 — 10 vistas `SECURITY DEFINER` en `sgc` (dev) — fuera de alcance de CU2

El mismo barrido encontró `ERROR security_definer_view` en 10 vistas de `sgc`
**solo en dev** (`v_movimientos_inventario`, `v_otros_valores_frecuentes`,
`v_conductor_documentos`, `v_conductor_stats`, `v_reporte_semanal_cumplimiento`,
`v_app_mi_contexto`, `v_expediente_obra_resumen`, `v_proyecto_avance`,
`v_proyecto_readiness`, `v_vehiculo_stats`) — ninguna aparece en prod. Esto
**NO estaba en los correos de Supabase que Xaviel reenvió** (esos eran
`rls_disabled_in_public`/`sensitive_columns_exposed`) y no se tocó en esta
ronda: una vista `SECURITY DEFINER` corre con los privilegios de quien la creó,
no de quien la consulta — eso puede ser **intencional** (agregar datos cruzados
que el que consulta no vería fila por fila, p. ej. estadísticas de flota) o un
**descuido real** (expone más de lo que debería). Revisar las 10, una por una,
necesita entender qué filtra cada vista — queda para una ronda aparte, no para
decidirse a la ligera dentro de CU2. Anotado aquí para que no se pierda.

## Hallazgo 4 — EXECUTE a `PUBLIC` en funciones nuevas (confirmado, NO corregido — deuda ya conocida)

Verificando `sgc.envio_automatico_probar` (nueva, CU3) en prod se notó que tiene
`EXECUTE` concedido a `PUBLIC` (el default de Postgres para funciones nuevas si
no se hace `revoke execute from public` explícito — a diferencia de las tablas,
que no regalan nada a `PUBLIC` por defecto). Se confirmó que **TODA la familia**
`envio_automatico_*` (incluidas las de CT10, no solo la nueva) tiene el mismo
default — no es un error de esta migración, es el comportamiento de Postgres
que nadie cierra en ningún `create function` de este repo. **No representa un
riesgo real hoy**: las funciones sensibles de la familia (`envio_automatico_set`,
`envio_automatico_probar`) ya validan `sgc.is_admin()` por dentro — un llamado
anónimo recibe un `42501` limpio, no datos. Es la misma clase de hallazgo que
`CR1` (`sql/2026-10-18-cr1-fase5-revoca-grant-publico-resend-key.sql`,
18-oct-2026) ya documentó para ~30 funciones de dev: "queda documentado un
barrido más amplio... como pendiente de Tecnología". No se corrigió función por
función aquí (inconsistente con sus hermanas de la misma familia) — se suma
este hallazgo al barrido pendiente, no es un fix aislado de esta ronda.

## El esquema `web`

`web` también está en `db_schema` (expuesto por la API) pero es de **otra
aplicación** (un sitio/CMS — `site_content`, `leads`, `clients`, `projects`,
`posts`, `jobs`, `media`…) que comparte este mismo proyecto Supabase con el SGC.
No es código de este repo — fuera de alcance. Se revisó de pasada (20-oct-2026):
todas sus tablas tienen RLS activa salvo `web.migrations`, que no tiene RLS pero
tampoco tiene ningún GRANT a `anon`/`authenticated`/`public` (sin privilegio =
sin acceso por la API, independientemente de la RLS) — no es un gap real hoy,
pero si algún día esa app cambia sus grants, revisar aparte (no es
responsabilidad del SGC).

## Cómo revisar los advisors de Supabase (cada ronda / cuando llegue un correo)

1. **No pulses "Resolve issue" en el dashboard de Supabase a ciegas** — puede
   activar RLS sin políticas y romper algo que de verdad se usa por la API.
2. **Primero, el motor REAL de advisors** (autoritativo — esto es lo que
   realmente manda los correos, no una aproximación):
   ```
   curl -s "https://api.supabase.com/v1/projects/<ref>/advisors/security" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | jq '.lints[] | select(.level=="ERROR")'
   ```
   Revisa **todo el esquema que aparezca** (`sgc`, `public`, `web`…) — no asumas
   que "público" significa el esquema `public` (ver arriba, hallazgo 2).
3. Luego, el chequeo propio de este repo (más rápido, pero **solo cubre el
   esquema `public` literal** — es un complemento, no un reemplazo del paso 2):
   ```
   node scripts/audit-public-schema-cu2.mjs --env dev
   node scripts/audit-public-schema-cu2.mjs --env prod --yes
   ```
4. Para cada tabla que aparezca: identifica de dónde viene (¿la crea una
   migración de `sql/`? ¿otra app que comparte el proyecto, como `web`? ¿una
   herramienta externa conectada por Postgres directo, como n8n?) y si algo la
   usa de verdad por la API (¿alguna RPC `security invoker` la lee? ¿el
   front-end la consulta directo?).
5. **No se borra nada sin confirmar uso real.** Default: bloquear (RLS activa
   sin políticas + `revoke all … from anon, authenticated, public`) si nadie la
   usa por la API; política explícita mínima (como `auditoria_frases`, hallazgo
   2) si sí se usa.
6. El paso 3 corre automáticamente en `scripts/release-check.mjs` (check
   `seguridad-public`) antes de todo PR `dev → main` — si aparece una tabla
   nueva de `public` expuesta, el release-check falla. **No cubre `sgc` ni
   `web`** (ver hallazgo 2) — el paso 2 (motor real de advisors) sigue siendo
   manual, hazlo cuando llegue un correo de Supabase o antes de un release
   grande.
7. `scripts/verify-public-schema-rls.mjs` (prebuild, estático) falla el build si
   una migración de `sql/*.sql` hace `create table public.…` sin activar RLS en
   la misma migración — para que una tabla nueva de `public` nunca llegue a
   aplicarse sin RLS desde el día uno. (No puede detectar una tabla de `sgc` sin
   RLS porque en `sgc` ESO es el patrón normal con RPC `security definer` —
   solo el paso 2 lo atrapa cuando el patrón se repite mal, como en hallazgo 2.)
8. Vuelve a correr el paso 2 después de aplicar el fix, para confirmar que el
   aviso desaparece — sin pulsar "Resolve", solo para verificar.

## Estado (21-oct-2026, verificado contra el motor real de advisors)

| Hallazgo | dev | prod |
|---|---|---|
| `public.n8n_chat_histories` (rls_disabled_in_public + sensitive_columns_exposed) | ✅ cerrado (ronda CT) | ✅ cerrado (ronda CT) |
| Default privileges de `public` regalando acceso a objetos nuevos | ✅ cerrado (CU2) | ✅ **cerrado (CU2, OK de Xaviel 21-oct)** |
| `sgc.auditoria_frases` (rls_disabled_in_public) | ✅ cerrado (CU2) | ✅ **cerrado (CU2, OK de Xaviel 21-oct)** |
| 10 vistas `SECURITY DEFINER` en `sgc` | 🟡 sin tocar, fuera de alcance de CU2 | (no aparecen) |
| `sensitive_columns_exposed` | ✅ ya no aparece en el motor de advisors | ✅ ya no aparece |

**Confirmado 21-oct-2026 contra el motor real de advisors tras aplicar ambas migraciones a prod: 0 lints `ERROR` en prod** (antes: 2 — `rls_disabled_in_public` × `sgc.auditoria_frases` y el riesgo de default privileges, que el advisor no reporta como lint propio pero era la causa raíz del hallazgo 1). Los 10 `security_definer_view` de dev siguen sin tocar (fuera de alcance, no aparecían en prod de todas formas).
