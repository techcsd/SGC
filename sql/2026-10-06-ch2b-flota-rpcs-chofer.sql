-- ════════════════════════════════════════════════════════════════════════════
-- CH2b — Gate de `validar_km_vehiculo` y `listar_proveedores_para_flota` incluye
--        a los CONDUCTORES (app). `crear_mantenimiento_app` ya permite a cualquier
--        fila de `conductores` registrar; estos dos RPCs (CH1/CH2) solo abrían a
--        flota/admin/elevado → un chofer sin el módulo `flota` podía CREAR pero no
--        validar el km ni ver la lista de talleres. Se alinean los tres gates.
--        `create or replace`, solo cambia el predicado de autorización. ADITIVO.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── validar_km_vehiculo: + conductores en el gate (resto idéntico a CH1) ──────
create or replace function sgc.validar_km_vehiculo(
  p_vehiculo uuid,
  p_km numeric,
  p_fecha timestamptz,
  p_excluir_mant uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_medida   text;
  v_unidad   text;
  v_fecha    date := coalesce(p_fecha::date, current_date);
  v_km_antes     numeric; v_fecha_antes date; v_fuente_antes text;
  v_km_despues   numeric; v_fecha_despues date; v_fuente_despues text;
  v_dias     numeric;
  v_umbral   numeric;
  v_tasa     numeric;
  v_nivel    text := 'ok';
  v_mensaje  text := null;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid())) then
    raise exception 'Tu usuario no tiene el módulo Flota' using errcode = '42501';
  end if;
  if p_vehiculo is null or p_km is null then
    return jsonb_build_object('ok', true, 'nivel', 'ok');
  end if;

  select coalesce(medida_uso,'km') into v_medida from sgc.vehiculos where id = p_vehiculo;
  if v_medida is null then
    return jsonb_build_object('ok', true, 'nivel', 'ok');
  end if;
  v_unidad := case when v_medida = 'horas' then 'h' else 'km' end;

  with lecturas as (
    select rc.fecha::date as f, rc.kilometraje::numeric as km, 'echada'::text as fuente
      from sgc.registros_combustible rc
     where rc.vehiculo_id = p_vehiculo and rc.kilometraje is not null
       and not coalesce(rc.invalidada,false) and not coalesce(rc.es_prueba,false)
    union all
    select cv.fecha::date, cv.kilometraje, 'inspección'
      from sgc.checklists_vehiculo cv
     where cv.vehiculo_id = p_vehiculo and cv.kilometraje is not null
    union all
    select coalesce(ve.capturado_en, ve.created_at)::date, ve.km, 'entrega'
      from sgc.vehiculo_entregas ve
     where ve.vehiculo_id = p_vehiculo and ve.km is not null
    union all
    select m.fecha::date, m.kilometraje_al_mantenimiento::numeric, 'mantenimiento'
      from sgc.mantenimientos m
     where m.vehiculo_id = p_vehiculo and m.kilometraje_al_mantenimiento is not null
       and not coalesce(m.es_prueba,false)
       and (p_excluir_mant is null or m.id <> p_excluir_mant)
  ),
  ant as (select km, f, fuente from lecturas where f <= v_fecha order by f desc, km desc limit 1),
  des as (select km, f, fuente from lecturas where f >  v_fecha order by f asc,  km asc  limit 1)
  select ant.km, ant.f, ant.fuente, des.km, des.f, des.fuente
    into v_km_antes, v_fecha_antes, v_fuente_antes, v_km_despues, v_fecha_despues, v_fuente_despues
    from (select 1) x
    left join ant on true
    left join des on true;

  if v_km_antes is not null and p_km < v_km_antes then
    v_nivel := 'error';
    v_mensaje := format('El %s %s registró %s %s; este registro (%s) no puede tener menos.',
      to_char(v_fecha_antes,'DD/MM/YYYY'), v_fuente_antes,
      trim(to_char(v_km_antes,'FM999G999G990')), v_unidad, to_char(v_fecha,'DD/MM/YYYY'));

  elsif v_km_despues is not null and p_km > v_km_despues then
    v_nivel := 'error';
    v_mensaje := format('El %s (%s) la lectura fue %s %s; este registro (%s) es anterior y no puede superarla.',
      to_char(v_fecha_despues,'DD/MM/YYYY'), v_fuente_despues,
      trim(to_char(v_km_despues,'FM999G999G990')), v_unidad, to_char(v_fecha,'DD/MM/YYYY'));

  elsif v_km_antes is not null and p_km > v_km_antes then
    v_dias := greatest(1, (v_fecha - v_fecha_antes));
    v_umbral := coalesce(
      (select valor from sgc.flota_config
        where clave = case when v_medida='horas' then 'horas_dia_max' else 'km_dia_max' end),
      case when v_medida='horas' then 24 else 800 end);
    v_tasa := (p_km - v_km_antes) / v_dias;
    if v_tasa > v_umbral then
      v_nivel := 'aviso';
      v_mensaje := format('Son %s %s más que la última lectura de hace %s día(s). ¿Es correcto?',
        trim(to_char(p_km - v_km_antes,'FM999G999G990')), v_unidad, trim(to_char(v_dias,'FM999G990')));
    end if;
  end if;

  return jsonb_build_object(
    'ok', v_nivel <> 'error',
    'nivel', v_nivel,
    'unidad', v_unidad,
    'medida_uso', v_medida,
    'km_antes', v_km_antes,
    'fecha_antes', v_fecha_antes,
    'fuente_antes', v_fuente_antes,
    'km_despues', v_km_despues,
    'fecha_despues', v_fecha_despues,
    'fuente_despues', v_fuente_despues,
    'mensaje', v_mensaje
  );
end;
$function$;
grant execute on function sgc.validar_km_vehiculo(uuid, numeric, timestamptz, uuid) to authenticated, service_role;

-- ── listar_proveedores_para_flota: + conductores en el gate ──────────────────
create or replace function sgc.listar_proveedores_para_flota()
returns table(id uuid, nombre text, tipos text[], es_taller boolean)
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select p.id, p.nombre, coalesce(p.tipos,'{}'::text[]) as tipos,
         ('taller' = any(coalesce(p.tipos,'{}'::text[]))) as es_taller
  from sgc.proveedores p
  where coalesce(p.activo, true) and not coalesce(p.es_prueba, false)
    and (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_flota_elevado()
         or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario')
         or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid()))
  order by ('taller' = any(coalesce(p.tipos,'{}'::text[]))) desc, lower(p.nombre);
$function$;
grant execute on function sgc.listar_proveedores_para_flota() to authenticated, service_role;

commit;
