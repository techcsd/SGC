-- =============================================================================
-- PROMPT-25 FASE 2 (BE2) — 3 tools nuevas de Compa, gateadas por rol.
-- Ronda 19/08-01/09/2026 (IDs BE). Aditivo, idempotente, retrocompatible.
--
-- Los 3 gaps de las capturas:
--   1) actividad_de_usuario   — "¿qué hizo hoy Misael?": supervisión ve a cualquier
--                               chofer; un chofer NO ve la de otro.
--   2) rutas_del_dia          — "todas las rutas de hoy": supervisión = todas;
--                               chofer = las suyas (misma fuente que Seguimiento, AU1).
--   3) disponibilidad_de_articulo — "¿en qué almacenes/proyectos hay puntales?":
--                               resuelve por apodo (AU12) y devuelve dónde hay stock,
--                               filtrado por lo que el rol puede ver (RLS por bodega).
--
-- "Equipo" del jefe de flota = TODOS los choferes (no hay asignación jefe→chofer;
--  decisión de Xaviel PROMPT-25). Supervisión = admin/dirección/gerencia/logística/
--  jefe de flota (+ flota elevado). Un solo camino (AU1): mismas fuentes que las
--  pantallas de Seguimiento / Inventario / Actividad.
-- =============================================================================

begin;

-- ── Helper: ¿puede ver la actividad/rutas del EQUIPO (no solo lo suyo)? ───────
create or replace function sgc.es_supervision_operativa()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or sgc.es_flota_elevado()
      or exists (
        select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = auth.uid()
          and r.codigo in ('admin','direccion','gerencia','logistica','jefe_flota')
      );
$$;
grant execute on function sgc.es_supervision_operativa() to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1) actividad_de_usuario — el "¿qué hizo hoy X?"
--    Respuesta MAGRA de alta señal (BB): conteos + listas cortas por dominio.
--    Autorización: solo lo propio, salvo supervisión operativa. Sin permiso → 42501
--    (el edge lo traduce a "no tengo acceso a eso" y lo registra como sin_permiso).
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.actividad_de_usuario(
  p_usuario_id uuid default null,
  p_fecha date default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid := coalesce(p_usuario_id, v_uid);
  v_fecha  date := coalesce(p_fecha, (now() at time zone 'America/Santo_Domingo')::date);
  v_admin  boolean := sgc.is_admin();
  v_nombre text;
  v_result jsonb;
begin
  -- Gate: un usuario ve lo suyo; la actividad de OTRO requiere supervisión.
  if v_target <> v_uid and not sgc.es_supervision_operativa() then
    raise exception 'No autorizado para ver la actividad de otra persona'
      using errcode = '42501';
  end if;

  select nombre into v_nombre from sgc.usuarios where id = v_target;
  if v_nombre is null then
    return jsonb_build_object('error','usuario_no_encontrado');
  end if;

  with
  -- Rutas donde el usuario fue el conductor (por su vínculo en conductores).
  rutas as (
    select r.origen, r.destino, r.estado, r.iniciada_at, r.finalizada_at
    from sgc.rutas r
    join sgc.conductores c on c.id = r.conductor_id
    where c.usuario_id = v_target
      and (r.fecha = v_fecha or (r.finalizada_at at time zone 'America/Santo_Domingo')::date = v_fecha)
      and (v_admin or not coalesce(r.es_prueba,false))
  ),
  -- Conduces que emitió/despachó ese día.
  conduces as (
    select s.id, s.estado, p.nombre proyecto, s.created_at
    from sgc.salidas_inventario s
    left join sgc.proyectos p on p.id = s.proyecto_id
    where (s.despachante_usuario_id = v_target or s.creado_por = v_target)
      and (s.created_at at time zone 'America/Santo_Domingo')::date = v_fecha
      and (v_admin or not coalesce(s.es_prueba,false))
  ),
  -- Echadas de combustible que registró (válidas y también las anuladas, marcadas).
  echadas as (
    select rc.galones, rc.monto, v.placa, rc.invalidada
    from sgc.registros_combustible rc
    left join sgc.vehiculos v on v.id = rc.vehiculo_id
    left join sgc.conductores c on c.id = rc.conductor_id
    where (rc.registrado_por = v_target or c.usuario_id = v_target)
      and rc.fecha = v_fecha
      and (v_admin or not coalesce(rc.es_prueba,false))
  ),
  -- Bitácoras que llenó ese día.
  bitacoras as (
    select b.id, p.nombre proyecto, b.tipo
    from sgc.bitacoras b
    left join sgc.proyectos p on p.id = b.proyecto_id
    where b.usuario_id = v_target and b.fecha = v_fecha
      and (v_admin or not coalesce(b.es_prueba,false))
  )
  select jsonb_build_object(
    'usuario', v_nombre,
    'fecha', v_fecha,
    'rutas', jsonb_build_object(
      'total', (select count(*) from rutas),
      'completadas', (select count(*) from rutas where estado = 'completada'),
      'detalle', coalesce((select jsonb_agg(jsonb_build_object(
        'origen', origen, 'destino', destino, 'estado', estado)) from rutas), '[]'::jsonb)),
    'conduces', jsonb_build_object(
      'total', (select count(*) from conduces),
      'detalle', coalesce((select jsonb_agg(jsonb_build_object(
        'obra', proyecto, 'estado', estado)) from conduces), '[]'::jsonb)),
    'echadas', jsonb_build_object(
      'total', (select count(*) from echadas where not coalesce(invalidada,false)),
      'galones', coalesce((select sum(galones) from echadas where not coalesce(invalidada,false)),0),
      'invalidadas', (select count(*) from echadas where coalesce(invalidada,false))),
    'bitacoras', jsonb_build_object(
      'total', (select count(*) from bitacoras),
      'detalle', coalesce((select jsonb_agg(jsonb_build_object(
        'obra', proyecto, 'tipo', tipo)) from bitacoras), '[]'::jsonb))
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function sgc.actividad_de_usuario(uuid, date) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2) rutas_del_dia — panorama del día por rol.
--    Supervisión → TODAS las rutas del día (misma fuente que Seguimiento/Panel).
--    Otro → solo las suyas (paridad con mis_rutas_hoy). Un solo camino (AU1).
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.rutas_del_dia(
  p_fecha date default null
) returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with base as (
    select r.id, r.origen, r.destino, r.estado, r.fecha,
           r.iniciada_at, r.finalizada_at, r.modificada_at,
           coalesce(cu.nombre, c.nombre) as conductor,
           v.placa
    from sgc.rutas r
    left join sgc.conductores c on c.id = r.conductor_id
    left join sgc.usuarios cu on cu.id = c.usuario_id
    left join sgc.vehiculos v on v.id = r.vehiculo_id
    where (r.fecha = coalesce(p_fecha, (now() at time zone 'America/Santo_Domingo')::date)
           or r.estado = 'en_curso')
      and (sgc.is_admin() or not coalesce(r.es_prueba,false))
      and (
        -- supervisión ve todas; el resto solo las suyas.
        sgc.es_supervision_operativa()
        or c.usuario_id = auth.uid()
        or r.creado_por = auth.uid()
      )
  )
  select jsonb_build_object(
    'fecha', coalesce(p_fecha, (now() at time zone 'America/Santo_Domingo')::date),
    'alcance', case when sgc.es_supervision_operativa() then 'todas' else 'propias' end,
    'total', (select count(*) from base),
    'por_estado', coalesce((
      select jsonb_object_agg(estado, n) from (
        select estado, count(*) n from base group by estado
      ) x), '{}'::jsonb),
    'rutas', coalesce((select jsonb_agg(jsonb_build_object(
      'origen', origen, 'destino', destino, 'estado', estado,
      'conductor', conductor, 'placa', placa) order by finalizada_at desc nulls last)
      from base), '[]'::jsonb)
  );
$$;
grant execute on function sgc.rutas_del_dia(date) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3) disponibilidad_de_articulo — "¿dónde hay puntales?"
--    Resuelve el artículo por nombre/código/APODO (AU12) y devuelve dónde hay
--    existencia (almacenes + obra asociada), filtrado por RLS de bodega (solo las
--    que el usuario puede ver). Si el término es ambiguo, devuelve candidatos.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.disponibilidad_de_articulo(
  p_query text default null,
  p_articulo_id uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_art uuid := p_articulo_id;
  v_nombre text; v_codigo text; v_unidad text;
  v_cands jsonb;
  v_top real;
  v_second real;
begin
  -- Resolver el artículo si no vino el id.
  if v_art is null then
    if coalesce(trim(p_query),'') = '' then
      return jsonb_build_object('error','falta_termino');
    end if;
    -- Reusa el buscador alias-aware (AU12). Toma los mejores candidatos.
    select jsonb_agg(jsonb_build_object(
             'articulo_id', id, 'nombre', nombre, 'codigo', codigo,
             'unidad', unidad, 'score', score, 'match_por', match_por) order by score desc),
           max(score),
           (array_agg(score order by score desc))[2]
      into v_cands, v_top, v_second
    from sgc.buscar_articulos(p_query, 6);

    if v_cands is null then
      return jsonb_build_object('encontrado', false, 'query', p_query,
        'mensaje', 'No hay ningún artículo que coincida con ese término (ni por apodo).');
    end if;

    -- Desambiguación: si el mejor no domina claramente, devuelve candidatos.
    if v_top is null or v_top < 0.35
       or (v_second is not null and (v_top - v_second) < 0.12) then
      return jsonb_build_object('encontrado', false, 'ambiguo', true,
        'query', p_query, 'candidatos', v_cands,
        'mensaje', 'Varios artículos coinciden — dime cuál.');
    end if;

    select (c->>'articulo_id')::uuid into v_art
    from jsonb_array_elements(v_cands) c
    order by (c->>'score')::real desc limit 1;
  end if;

  select nombre, codigo, unidad into v_nombre, v_codigo, v_unidad
  from sgc.articulos where id = v_art;
  if v_nombre is null then
    return jsonb_build_object('error','articulo_no_encontrado');
  end if;

  -- Existencias por bodega, SOLO en bodegas que el usuario puede ver (RLS por bodega).
  return jsonb_build_object(
    'encontrado', true,
    'articulo', jsonb_build_object('id', v_art, 'nombre', v_nombre,
                'codigo', v_codigo, 'unidad', v_unidad),
    'existencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'almacen', b.nombre, 'obra', p.nombre, 'cantidad', sb.cantidad,
        'unidad', v_unidad) order by sb.cantidad desc)
      from sgc.stock_por_bodega sb
      join sgc.bodegas b on b.id = sb.bodega_id
      left join sgc.proyectos p on p.id = b.proyecto_id
      where sb.articulo_id = v_art
        and coalesce(sb.cantidad,0) > 0
        and coalesce(b.activo, true)
        and (sgc.is_admin() or not coalesce(b.es_prueba,false))
        and sgc.puede_ver_inventario_bodega(b.id)
    ), '[]'::jsonb),
    'total_disponible', coalesce((
      select sum(sb.cantidad)
      from sgc.stock_por_bodega sb
      join sgc.bodegas b on b.id = sb.bodega_id
      where sb.articulo_id = v_art and coalesce(sb.cantidad,0) > 0
        and coalesce(b.activo, true)
        and (sgc.is_admin() or not coalesce(b.es_prueba,false))
        and sgc.puede_ver_inventario_bodega(b.id)
    ), 0)
  );
end;
$$;
grant execute on function sgc.disponibilidad_de_articulo(text, uuid) to authenticated, service_role;

commit;
