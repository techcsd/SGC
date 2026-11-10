-- =============================================================================
-- DL3/DL6 (continuación) — RPCs que `wa-extract` necesita para dedupe
-- semántico (DL-06), resolución de responsable (DL-08) y cierre automático
-- (DL-16). Migración separada de dl3-wa-seguimiento.sql porque esa ya se
-- aplicó (no se reescribe un archivo ya en el ledger).
--
-- Depende de: sql/2026-11-10-dl3-wa-seguimiento.sql (columnas responsable_id/
-- seguimiento/etc + wa_autor_usuario). pg_trgm/unaccent confirmados
-- disponibles en dev por F0.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl3c-wa-hallazgo-insertar-v2.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

create extension if not exists pg_trgm;
create extension if not exists unaccent;

create or replace function sgc.wa_hallazgo_insertar_v2(
  p_grupo_jid text, p_tipo text, p_resumen text, p_detalle text default null,
  p_personas jsonb default '[]'::jsonb, p_fecha_mencionada date default null,
  p_monto numeric default null, p_moneda text default null, p_proyecto_id uuid default null,
  p_mensaje_ids uuid[] default '{}', p_confianza numeric default null,
  p_responsable_hint text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'extensions', 'public', 'pg_temp'
as $$
declare
  v_ids_ordenados text; v_hash text; v_id uuid;
  v_dup_id uuid;
  v_responsable uuid; v_origen text;
  v_seguimiento text := 'sin';
  v_seguimiento_desde timestamptz;
  v_tipos_con_seguimiento text[] := array['tarea','pedido_material','fecha_limite','pregunta_abierta','acuerdo'];
begin
  select coalesce(string_agg(x::text, ',' order by x), '') into v_ids_ordenados
    from unnest(p_mensaje_ids) x;
  v_hash := encode(digest(
    coalesce(p_grupo_jid,'') || '|' || coalesce(p_tipo,'') || '|' || v_ids_ordenados || '|' || coalesce(p_resumen,''),
    'sha256'), 'hex');

  -- DL-06 — dedupe semántico: mismo tipo, grupo, no descartado, últimas 72h,
  -- similitud de redacción ≥ 0.85 (acentos/mayúsculas normalizados).
  select id into v_dup_id
  from sgc.wa_hallazgos
  where grupo_jid = p_grupo_jid
    and tipo = p_tipo
    and estado <> 'descartado'
    and creado_en > now() - interval '72 hours'
    and similarity(unaccent(lower(resumen)), unaccent(lower(p_resumen))) >= 0.85
  order by similarity(unaccent(lower(resumen)), unaccent(lower(p_resumen))) desc
  limit 1;

  if v_dup_id is not null then
    update sgc.wa_hallazgos
    set mensaje_ids = (select array(select distinct unnest(mensaje_ids || coalesce(p_mensaje_ids,'{}'))))
    where id = v_dup_id;
    return v_dup_id;
  end if;

  -- DL-08 — responsable: ① mención única (teléfono autorizado o nombre exacto
  -- normalizado) ② wa_grupos.responsables[1] ③ Tecnología. Dos coincidencias
  -- de nombre → no se adivina, cae al paso ②.
  if p_tipo = any(v_tipos_con_seguimiento) and p_responsable_hint is not null and trim(p_responsable_hint) <> '' then
    if p_responsable_hint ~ '\d{7,}' then
      v_responsable := sgc.wa_autor_usuario(p_responsable_hint);
      if v_responsable is not null then v_origen := 'ia'; end if;
    end if;
    if v_responsable is null then
      select u.id into v_responsable from sgc.usuarios u
        where u.activo and unaccent(lower(u.nombre)) = unaccent(lower(trim(p_responsable_hint))) limit 1;
      if v_responsable is not null and (
        select count(*) from sgc.usuarios u2
        where u2.activo and unaccent(lower(u2.nombre)) = unaccent(lower(trim(p_responsable_hint)))
      ) > 1 then
        v_responsable := null; -- duda real → no adivinar
      elsif v_responsable is not null then
        v_origen := 'ia';
      end if;
    end if;
  end if;

  if p_tipo = any(v_tipos_con_seguimiento) then
    if v_responsable is null then
      select (select responsables[1] from sgc.wa_grupos where jid = p_grupo_jid) into v_responsable;
      if v_responsable is not null then v_origen := 'grupo'; end if;
    end if;
    if v_responsable is null then
      select id into v_responsable from sgc.usuarios
        where lower(email) = lower('Tecnologia@constructorasd.com') and activo limit 1;
      if v_responsable is not null then v_origen := 'tecnologia'; end if;
    end if;
    if v_responsable is not null and p_confianza is not null and p_confianza >= 0.7 then
      v_seguimiento := 'activo';
      v_seguimiento_desde := now();
    end if;
  end if;

  insert into sgc.wa_hallazgos
    (grupo_jid, tipo, resumen, detalle, personas, fecha_mencionada, monto, moneda, proyecto_id,
     mensaje_ids, confianza, dedupe_hash, responsable_id, responsable_origen, seguimiento, seguimiento_desde)
  values
    (p_grupo_jid, p_tipo, p_resumen, p_detalle, coalesce(p_personas,'[]'::jsonb), p_fecha_mencionada, p_monto, p_moneda, p_proyecto_id,
     coalesce(p_mensaje_ids,'{}'), p_confianza, v_hash, v_responsable, v_origen, v_seguimiento, v_seguimiento_desde)
  on conflict (dedupe_hash) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.wa_hallazgo_insertar_v2(text,text,text,text,jsonb,date,numeric,text,uuid,uuid[],numeric,text) to service_role;

-- ── DL-16 — cierre automático cuando un mensaje responde/cumple un hallazgo
--      abierto. No reabre uno ya resuelto; no toca 'sin'/'pausado'. ─────────
create or replace function sgc.wa_hallazgo_cerrar_por_mensaje(
  p_hallazgo_id uuid, p_mensaje_id uuid default null, p_motivo text default null, p_confianza numeric default null
) returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  update sgc.wa_hallazgos
  set seguimiento = case when coalesce(p_confianza, 0) >= 0.7 then 'resuelto' else 'resuelto_probable' end,
      cierre_motivo = coalesce(p_motivo, cierre_motivo),
      cerrado_por_mensaje_id = coalesce(p_mensaje_id, cerrado_por_mensaje_id),
      cerrado_en = case when coalesce(p_confianza, 0) >= 0.7 then now() else cerrado_en end
  where id = p_hallazgo_id
    and seguimiento in ('activo', 'vencido');
end;
$$;
grant execute on function sgc.wa_hallazgo_cerrar_por_mensaje(uuid, uuid, text, numeric) to service_role;

commit;
