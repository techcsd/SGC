-- ============================================================================
-- X3 — Accidentes: fotos del hecho (además del acta AMET). Aditivo. Mismo
-- bucket `flota-documentos`/`accidentes` que ya usa el acta. El visor con
-- thumbnail + lightbox es 100% frontend (W9/W11).
-- ============================================================================

set search_path = sgc, public;

alter table sgc.vehiculo_accidentes add column if not exists fotos text[] not null default '{}';

-- Recrear registrar_accidente_app con p_fotos (jsonb [{storage_path}]) al final.
-- Se elimina el overload de 11 args para no dejar la función ambigua.
drop function if exists sgc.registrar_accidente_app(
  uuid, uuid, date, text, text, smallint, text, uuid, jsonb, text, timestamp with time zone);

create or replace function sgc.registrar_accidente_app(
  p_id uuid,
  p_vehiculo_id uuid,
  p_fecha date,
  p_fase text,
  p_descripcion text default null,
  p_lesionados smallint default 0,
  p_tercero text default null,
  p_conductor_id uuid default null,
  p_gps jsonb default null,
  p_reporte_amet_path text default null,
  p_capturado_en timestamp with time zone default now(),
  p_fotos jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_fotos text[];
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.vehiculo_accidentes where id = p_id) then
    return p_id;  -- idempotente
  end if;

  v_fotos := coalesce(
    (select array_agg(f->>'storage_path')
       from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
      where nullif(f->>'storage_path','') is not null),
    '{}');

  insert into sgc.vehiculo_accidentes (
    id, vehiculo_id, conductor_id, fecha, fase, descripcion, lesionados,
    tercero_involucrado, ubicacion_lat, ubicacion_lng, reporte_amet_path, fotos, creado_por, creado_en
  ) values (
    p_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), coalesce(p_fase,'posterior'),
    p_descripcion, coalesce(p_lesionados,0), p_tercero,
    nullif(p_gps->>'lat','')::numeric, nullif(p_gps->>'lng','')::numeric,
    p_reporte_amet_path, v_fotos, v_uid, coalesce(p_capturado_en, now())
  );

  return p_id;
end;
$function$;

grant execute on function sgc.registrar_accidente_app(
  uuid, uuid, date, text, text, smallint, text, uuid, jsonb, text, timestamp with time zone, jsonb
) to authenticated, service_role;
