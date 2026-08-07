-- =============================================================================
-- PROMPT-10 FASE 3 (AH8) — "Completar parada" con timestamp de TAP + ubicación GPS.
-- Aditivo y retrocompatible sobre AE5 (2026-08-01-ae5-ruta-parada-conduce.sql).
--
-- Hoy avanzar_parada fija llegada_at/entregada_at = now() (tiempo de PROCESO en el
-- servidor, no el del tap del chofer) y no guarda la ubicación donde se completó.
-- Con app offline, el tap puede ocurrir minutos/horas antes del envío. Añadimos:
--   • ruta_paradas.entregada_lat / entregada_lng / completada_por (dónde/quién).
--   • avanzar_parada gana p_at (instante del tap), p_lat, p_lng (opcionales, default
--     null → comportamiento idéntico al actual si el app no los envía).
-- El trigger de auto-completado por conduce (AE5 #6) sigue igual: si la parada tiene
-- entrega/conduce vinculado, la recepción la marca 'entregada' — sin doble marcado.
-- =============================================================================

begin;

alter table sgc.ruta_paradas
  add column if not exists entregada_lat  numeric,
  add column if not exists entregada_lng  numeric,
  add column if not exists completada_por uuid;
comment on column sgc.ruta_paradas.entregada_lat is 'AH8 — latitud donde el chofer completó la parada (tap).';

-- Reemplaza la firma de 6 args por una de 9 (los 3 nuevos con default → los
-- llamadores existentes de 6 args siguen resolviendo sin cambios).
drop function if exists sgc.avanzar_parada(uuid, text, text, text, text, text);

create or replace function sgc.avanzar_parada(
  p_parada_id   uuid,
  p_estado      text,                         -- 'en_camino' | 'entregada' | 'omitida'
  p_foto_path   text default null,
  p_firma_path  text default null,
  p_entregado_a text default null,
  p_notas       text default null,
  p_at          timestamptz default null,     -- AH8: instante del tap (offline-safe)
  p_lat         numeric default null,          -- AH8: ubicación de completado
  p_lng         numeric default null
) returns void language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare
  v_uid uuid := auth.uid();
  v_ruta_id uuid;
  v_at timestamptz := coalesce(p_at, now());
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_estado not in ('pendiente','en_camino','entregada','omitida') then
    raise exception 'Estado de parada inválido: %', p_estado;
  end if;

  select ruta_id into v_ruta_id from sgc.ruta_paradas where id = p_parada_id;
  if v_ruta_id is null then raise exception 'Parada no encontrada.'; end if;
  if not exists (select 1 from sgc.rutas r where r.id = v_ruta_id
       and (sgc.es_flota_elevado() or r.creado_por = v_uid
            or r.conductor_id in (select sgc.mis_conductor_ids()))) then
    raise exception 'No tienes permiso sobre esta ruta.';
  end if;

  update sgc.ruta_paradas set
    estado         = p_estado,
    llegada_at     = case when p_estado = 'en_camino' and llegada_at is null then v_at else llegada_at end,
    entregada_at   = case when p_estado = 'entregada' then v_at else entregada_at end,
    entregada_lat  = case when p_estado = 'entregada' then coalesce(p_lat, entregada_lat) else entregada_lat end,
    entregada_lng  = case when p_estado = 'entregada' then coalesce(p_lng, entregada_lng) else entregada_lng end,
    completada_por = case when p_estado = 'entregada' then coalesce(completada_por, v_uid) else completada_por end,
    entregado_a    = coalesce(nullif(p_entregado_a,''), entregado_a),
    foto_path      = coalesce(nullif(p_foto_path,''), foto_path),
    firma_path     = coalesce(nullif(p_firma_path,''), firma_path),
    notas_entrega  = coalesce(nullif(p_notas,''), notas_entrega)
  where id = p_parada_id;
end;
$$;
grant execute on function sgc.avanzar_parada(uuid, text, text, text, text, text, timestamptz, numeric, numeric) to authenticated, service_role;

commit;
