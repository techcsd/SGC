-- =============================================================================
-- PROMPT-28 (BG) FASE 4 — BG4: bucket de evidencia del retiro de material dañado.
-- Ronda 19/08-03/09/2026. Aditivo, idempotente.
-- Fotos del material dañado + placa/carga del conduce + firmas + foto de recepción.
-- Política: authenticated upload/read (paridad con sgc-bitacora); el acceso fino
-- lo dan las RLS de retiros_material/cuarentena y los RPCs DEFINER.
-- =============================================================================
insert into storage.buckets (id, name, public) values ('sgc-retiro','sgc-retiro', false)
  on conflict (id) do nothing;

drop policy if exists "sgc-retiro: authenticated read" on storage.objects;
create policy "sgc-retiro: authenticated read" on storage.objects
  for select to authenticated using (bucket_id = 'sgc-retiro');

drop policy if exists "sgc-retiro: authenticated upload" on storage.objects;
create policy "sgc-retiro: authenticated upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'sgc-retiro');
