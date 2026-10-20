-- 2026-10-20-ct9-bloquear-n8n-chat-histories.sql — CT9 (fila 269, prioridad máxima)
-- Supabase Advisors marcó `rls_disabled_in_public` (crítico, "cualquiera con la URL
-- del proyecto puede leer/editar/borrar todos los datos") en sgc-dev Y EN PROD, más
-- `sensitive_columns_exposed` en dev. La tabla es `public.n8n_chat_histories`
-- (id, session_id, message jsonb) — NO nace de ninguna migración de este repo (todo
-- el SGC vive en el esquema `sgc`); es del stack n8n (ws-intelligence, el bot de
-- WhatsApp — ver skill ws-ops) que se conecta DIRECTO al Postgres de este proyecto
-- Supabase (comparte credenciales) y n8n crea su propia tabla de memoria de chat ahí,
-- sin pasar por las convenciones de Supabase (RLS/GRANT). Supabase expone CUALQUIER
-- tabla de `public` por su API REST (PostgREST) por defecto — por eso una tabla de
-- n8n, 100% ajena al SGC, quedó alcanzable con la clave anon.
--
-- Verificado antes de tocar (solo lectura, ambos entornos): 0 filas hoy en dev y en
-- prod. n8n se conecta con la cadena de Postgres directa (rol con privilegios
-- reales, no `anon`/`authenticated` vía PostgREST), así que bloquear el acceso por
-- la API REST no debería afectar al workflow de n8n — confirmar con un `/health` de
-- n8n después de aplicar (ver HANDOFF). No se borra la tabla (podría tener uso real
-- para n8n); se bloquea el acceso público, como pide el default (CT9 §6: "las no
-- usadas se bloquean: RLS activo sin políticas + revoke a anon/authenticated").
begin;

alter table if exists public.n8n_chat_histories enable row level security;
-- Sin políticas: con RLS activo y ninguna política, authenticated/anon no ven NADA
-- por la API REST (ni con la service key se las salta por ahí — eso es justo el punto).
revoke all on public.n8n_chat_histories from anon, authenticated, public;

commit;
