-- 2026-10-20-cu2-auditoria-frases-rls.sql — CU2 (fila 269, prioridad máxima)
-- El Security Advisor de Supabase (autoritativo, `GET /v1/projects/{ref}/advisors/
-- security`, consultado en vivo 21-oct-2026) marca HOY mismo `rls_disabled_in_public`
-- en `sgc.auditoria_frases` en dev Y EN PROD — NO en el esquema `public` (eso ya lo
-- cerró CT9/CU2 con n8n_chat_histories): "público" en el nombre del lint significa
-- "alcanzable por el Data API", y `sgc` está en el `db_schema` expuesto igual que
-- `public`. La auditoría de CU2 centrada solo en el esquema `public` (y la de CT9)
-- no la vio por eso — este hallazgo es nuevo, confirmado contra el motor real de
-- advisors, no contra una heurística propia.
--
-- `sgc.auditoria_frases` (creada en sql/2026-10-16-cq3-auditoria-contexto.sql) es un
-- catálogo de frases en español ("verbo + sustantivo") para armar el feed de
-- auditoría legible — sin datos de usuarios, sin PII, sembrada solo por migración,
-- nunca escrita por la app (ver su propio comment on table). `grant select … to
-- authenticated` es necesario: `sgc.auditoria_frase()` (la RPC que la lee) es
-- `language plpgsql stable` SIN `security definer` — corre con los privilegios del
-- que llama, así que sin ese grant la RPC fallaría para cualquier usuario normal.
-- El contenido no es sensible, pero el patrón "RLS apagada + grant directo" es
-- exactamente lo que el advisor flaguea — se cierra con RLS activa + una política
-- de solo lectura que reproduce el mismo acceso de hoy (sin cambiar comportamiento).
begin;

alter table sgc.auditoria_frases enable row level security;

drop policy if exists auditoria_frases_sel on sgc.auditoria_frases;
create policy auditoria_frases_sel on sgc.auditoria_frases
  for select to authenticated
  using (true);

commit;
