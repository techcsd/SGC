# SGC-CSI-MOD-01: Módulo de Monitoreo de Infraestructura y Suscripciones

> Ronda 28/07/2026 · PROMPT-5 · Y17. Fuente de verdad: `notas-monitoreo-dominios-suscripciones-sgc.md` (spec aprobada por Xaviel). Este documento la formaliza 1:1; las desviaciones se marcan ⚠️.
> Estado: **implementado** (FASE 1 backend + FASE 2 panel + FASE 3 extras). Vive en la sección **Tecnología** (rol `admin`/`tecnologia`, PROMPT-1).

## 1. Contexto y objetivo
El 25-jul-2026 expiró `constructorasd.com` (registrador Squarespace, renovación dependía de un tercero): `clientHold` → NXDOMAIN → el correo entrante rebotó ~2 días y se perdió. Este módulo vigila dominios/DNS y suscripciones/pagos tecnológicos y **alerta de forma anticipada y escalonada** por un canal **externo al dominio vigilado** (Telegram), con histórico auditable y alertas persistentes hasta reconocimiento.

## 2. Alcance
- **v1 (FASES 1-3):** vigilancia de 2 dominios + N suscripciones; checks sin API keys (DoH + RDAP + HTTP/SSL); alertas escalonadas por Telegram (+ correo externo, best-effort); panel Angular con semáforos, CRUD de suscripciones, bandeja de alertas con acknowledge e histórico de checks; export a Excel.
- **Fuera de alcance:** los pendientes operativos NO técnicos (auto-renew Squarespace, acceso Wix, DKIM/DMARC, plantstudiod.com, avisar de correos perdidos) — van en `PLAN.md`, no en el código. Ver notas §6.

## 3. Modelo de datos (esquema `sgc`, aditivo)
- **`monitored_domains`**: `id, domain, registrar, dns_provider, expected_mx (jsonb), expected_spf_includes (text[]), dkim_selector (text), check_ssl (bool), is_active, notes, created_at`. ⚠️ Extiende las notas con `expected_spf_includes`, `dkim_selector`, `check_ssl` para los checks detallados de FASE 3.
- **`subscriptions`**: `id, name, provider, category, renewal_date, amount, currency, payment_method, account_owner, internal_responsible, impact_if_expired, panel_url, auto_renew (bool), payment_ok (bool), is_active, notes, created_at, updated_at`. ⚠️ `payment_ok` para modelar "pago rechazado" (estado fatal).
- **`domain_checks`** (histórico): `id, domain_id, check_type (dns_resolution|rdap_status|mx_records|spf|dkim|ssl|http), status (ok|warning|critical), detail (text), raw_response (jsonb), checked_at`.
- **`alerts`**: `id, source_type (domain|subscription), source_id, alert_type, severity (info|media|alta|critica), message, notified_channels (jsonb), last_notified_at, acknowledged_by, acknowledged_at, resolved_at, created_at`. Dedup por (source_type, source_id, alert_type) activo (acknowledged_at IS NULL AND resolved_at IS NULL).

## 4. Umbrales y matriz de escalamiento (notas §2, no negociable)
| Condición | Severidad | Canal / cadencia |
|---|---|---|
| 60 días antes de vencer | `info` | Panel (warning). Sin Telegram. |
| 30 días antes | `media` | Telegram + panel. Notifica al crearse. |
| 14 días antes | `alta` | Telegram **diario** hasta acknowledge. |
| 7 días antes | `critica` | Telegram diario (matriz de escalamiento). |
| **Estado fatal** (`clientHold`, NXDOMAIN, web≠200, pago rechazado) | `critica` | Telegram **inmediato**, sin esperar umbral. |

- Alertas **persistentes hasta acknowledge** (`acknowledged_by`/`acknowledged_at`). No de una sola vez.
- **Anti-ruido**: la FILA de alerta se crea solo en **cambio de estado** (dedup por clave activa). La **re-notificación** Telegram se limita por severidad: `media` una vez al crear; `alta`/`critica` una vez por día (`last_notified_at`). Al recuperarse el estado (ok), la alerta se marca `resolved_at`.
- ⚠️ **Matriz de escalamiento**: v1 usa **un chat de Telegram** (puede ser grupo con varios responsables) + correo externo secundario. La diferenciación de destinatarios por severidad (7 días → responsables adicionales) se implementa como "mismo chat, prefijo 🔴 CRÍTICA"; ampliar a destinatarios por severidad = backlog.

## 5. Canales de alerta (externos al dominio, notas §2)
> **Decisión 28/07 (Xaviel): canal PRIMARIO = correo.** La regla "externo al dominio vigilado" se cumple porque el SGC envía por **Resend desde `sgcconstructorasd.com`**, un dominio **distinto e independiente** de `constructorasd.com` (el vigilado). Aunque `constructorasd.com` caiga (clientHold/NXDOMAIN), el correo de alerta sale igual. Solo hay que asegurar que **al menos un destinatario sea externo** (un Gmail) para el caso extremo en que el correo corporativo entrante esté caído.
- **Primario — correo (Resend)**: `from` = `NOTIFICATIONS_FROM_EMAIL` (`notificaciones@sgcconstructorasd.com`, ya verificado). Destinatarios = `INFRA_ALERT_EMAILS` — **configurado (28/07)** con el correo corporativo (`tecnologia@constructorasd.com`) **+ un Gmail EXTERNO** (fuera de `constructorasd.com`), de modo que aunque el correo corporativo entrante esté caído, la alerta llega igual a la bandeja externa. Los valores viven solo en el secret de función (no en el repo). Resend key desde Vault; no-op si falta.
- **Secundario — Telegram (OPCIONAL)**: si algún día se setean los secrets `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID`, el envío Telegram se suma automáticamente (canal 100% independiente del dominio). No es requisito; queda cableado por si se quiere.

## 6. Arquitectura
- **Edge `check-domains`** (Deno, `--no-verify-jwt`, auth por `x-sync-secret`): por cada dominio activo corre DoH (`dns.google/resolve`: A/AAAA resolución, MX vs `expected_mx`, TXT SPF vs `expected_spf_includes`, TXT `<selector>._domainkey` DKIM), RDAP (`rdap.org/domain/X`: status `clientHold`=fatal, fecha de expiración → umbrales), y HTTP/SSL (web 200 + expiración de certificado). Inserta en `domain_checks`; llama `sgc.raise_infra_alert`/`resolve_infra_alert` (solo cambio de estado); envía Telegram para alertas nuevas o re-notificables.
- **Edge `check-subscriptions`** (Deno): calcula días restantes desde `renewal_date`; aplica umbrales; `payment_ok=false` o `is_active=false` inesperado = fatal; crea/re-notifica alertas.
- **DB helpers**: `sgc.raise_infra_alert(...)` (dedup + upsert, devuelve `is_new`/`should_notify`), `sgc.resolve_infra_alert(...)`, `sgc.acknowledge_alert(alert_id)` (traza usuario+fecha), `sgc.infra_status()` (resumen para el panel).
- **pg_cron + pg_net**: `check-domains` cada 2h; `check-subscriptions` cada 12h (⚠️ notas sugieren DNS 1-2h y RDAP/subs 12-24h por separado; se unifica dominio en un solo check cada 2h por simplicidad — solo 2 dominios; ampliable).
- **RLS**: `monitored_domains`, `subscriptions`, `domain_checks`, `alerts` → SELECT solo `sgc.es_tecnologia()` (admin|tecnologia); escritura por `service_role` (edge). CRUD de suscripciones desde el panel vía RPCs gateados a `es_tecnologia()`.

## 7. Inventario inicial cargado (seed, notas §3)
- Dominios: **constructorasd.com** (Squarespace / Wix DNS; MX Google; SPF `include:_spf.google.com`; DKIM `google`; SSL), **plantstudiod.com** (mismos checks; nota: "Acción necesaria" en Google Admin, pendiente de revisar).
- Suscripciones: **Squarespace** (dominio constructorasd.com, verificar auto-renew), **Wix** (web/DNS, NS10/NS11.WIXDNS.NET), **Google Workspace**, **Supabase** (proyecto SGC), **Vercel** (hosting web). Fechas/montos a completar por Xaviel desde el panel.

## 8. Fases
- **FASE 1 (elimina el riesgo):** tablas + edges + cron + Telegram + seed. ✅
- **FASE 2:** panel Angular (semáforos, CRUD suscripciones, bandeja de alertas, histórico). ✅
- **FASE 3:** SPF/DKIM/SSL detallado + export. ✅

## 9. Verificación
Checks manuales llenan `domain_checks` con datos reales; NXDOMAIN (dominio inexistente de prueba) → alerta `critica` inmediata por Telegram; alerta no reconocida se repite (alta/crítica diaria); acknowledge la detiene; usuario sin rol no ve nada (RLS + guard). Ver §"COMO QUEDÓ" al final.

---

## COMO QUEDÓ (implementado 28/07/2026)

**Migraciones (prod):** `sql/2026-07-28-y17-monitoreo-infra-schema.sql` (tablas + RLS + grants + seed), `...-rpcs.sql` (raise/mark/resolve/acknowledge/set_domain_status/_sev_rank), `...-cron.sql` (pg_cron). **Edges desplegadas** (`--no-verify-jwt`, auth `x-sync-secret`): `check-domains`, `check-subscriptions`. **Secrets:** `infra_sync_secret` (Vault) + `INFRA_SYNC_SECRET` (función).

**Verificado end-to-end:**
- `check-domains` real: constructorasd.com → DNS ok, MX Google ok, SPF ok (`include:_spf.google.com`), RDAP ok (expira **2032-07-25**), DKIM **warning** (ausente/pendiente — coincide con el pendiente operativo real), HTTP responde. plantstudiod.com → todo ok, expira 2027-02-12. 60 filas reales en `domain_checks`.
- Estado fatal: dominio inexistente → alerta **`critica` `dns_down` inmediata** (Telegram intentado → `skipped` sin token). Re-notificación: envejeciendo `last_notified_at` a ayer, la siguiente corrida re-notifica (alta/crítica, 1×/día); **acknowledge la silencia** (misma corrida con NXDOMAIN persistente NO re-notifica ni duplica la fila). Recuperación → `resolve_infra_alert`.
- **Dedup por alerta NO resuelta** (reconocida o no): el problema persistente no crea filas nuevas; sólo una reaparición tras resolver crea una fresca.
- RLS: RRHH (sin rol) ve 0 en las 4 tablas; admin ve todo.
- `pg_cron`: `sgc-check-domains` (cada 2h), `sgc-check-subscriptions` (cada 12h), activos.

**UI (FASE 2):** `/tecnologia/monitoreo` (guard `tecnologiaGuard`, nav "Monitoreo de infraestructura" en Tecnología, `soloTecnologia`). Pestañas: Dominios (semáforo + días para expirar + último check), Suscripciones (tabla ordenada por proximidad + CRUD en drawer), Alertas (bandeja con "Reconocer" + filtro activas/históricas + badge de activas), Histórico (checks filtrables por dominio/tipo + export a Excel). `MonitoringService` + `monitoring.model.ts`.

**FASE 3:** SPF/DKIM/SSL(vía HTTPS)/MX detallados ya en `check-domains`; export de histórico en el panel. ⚠️ Expiración fina del certificado SSL no se mide (un cert vencido rompe el `fetch https` → se alerta `web_down`); medición exacta de días del cert = backlog.

**Canal primario = correo** (Resend desde `sgcconstructorasd.com`, independiente del dominio vigilado). Verificado 28/07: NXDOMAIN de prueba → alerta `critica` → **correo enviado** (`notified_channels: email ok=true`) a `tecnologia@constructorasd.com`. Telegram quedó OPCIONAL (solo si se setean sus secrets). `INFRA_ALERT_EMAILS` **ya seteado** con corporativo + Gmail externo; verificado con `recipients:2` y correo `ok=true` a ambas bandejas. **Sin pendientes técnicos.**
