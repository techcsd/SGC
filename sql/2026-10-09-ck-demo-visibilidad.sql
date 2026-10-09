-- 2026-10-09-ck-demo-visibilidad.sql   ⚠️ SOLO DEV (depende de sgc.es_usuario_demo(), que es dev-only)
-- NO aplicar a prod: en prod no existe es_usuario_demo() y no hace falta — las fuentes DEFINER
-- de abajo ya están gated por rol/módulo, y ningún usuario de prod es a la vez revisor_tiendas
-- y logística, así que no hay exposición real. Esto es herramienta de GRABACIÓN de videos CK5.
-- CK5 (privacidad) — endurece las fuentes DEFINER que ignoraban la RLS de datos de prueba:
-- un usuario demo (revisor_tiendas o flag tutorial_demo, vía sgc.es_usuario_demo()) NUNCA
-- debe ver datos reales, ni siquiera por estos RPCs. Para usuarios normales NO cambia nada
-- (`not es_usuario_demo()` es true → se conserva el comportamiento actual). Esto además
-- protege la cuenta de revisor de tiendas (CI11) y habilita grabar los videos CK5 con solo
-- datos falsos. Regla 19: cada función se re-crea con su cuerpo vivo + un solo filtro.
--   node scripts/apply-migration.mjs sql/2026-10-09-ck-demo-visibilidad.sql --env dev

begin;

-- 1) Mantenimientos: antes mostraba (not es_prueba)→ al demo le salían los REALES. Ahora el
--    demo ve solo es_prueba.
create or replace function sgc.listar_mantenimientos(p_vehiculo uuid default null, p_limite integer default 50, p_cursor_fecha date default null, p_cursor_id uuid default null)
returns setof jsonb language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select jsonb_build_object(
      'id', m.id, 'vehiculo_id', m.vehiculo_id, 'tipo', m.tipo,
      'descripcion', m.descripcion, 'fecha', m.fecha, 'costo', m.costo,
      'kilometraje_al_mantenimiento', m.kilometraje_al_mantenimiento,
      'proveedor', m.proveedor, 'estado', m.estado, 'notas', m.notas,
      'fotos', m.fotos, 'es_prueba', m.es_prueba,
      'incluye_preventivo', m.incluye_preventivo, 'accidente_id', m.accidente_id,
      'creado_por', m.creado_por, 'created_at', m.created_at,
      'vehiculo', jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo),
      'creado_por_usuario', case when u.id is not null then jsonb_build_object('nombre', u.nombre) else null end,
      'adjuntos', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', a.id, 'path', a.path, 'nombre', a.nombre, 'mime', a.mime, 'tipo_documento', a.tipo_documento
            ) order by a.created_at)
          from sgc.mantenimiento_adjuntos a where a.mantenimiento_id = m.id
        ), '[]'::jsonb)
    )
  from sgc.mantenimientos m
  left join sgc.vehiculos v on v.id = m.vehiculo_id
  left join sgc.usuarios  u on u.id = m.creado_por
  where (case when sgc.es_usuario_demo() then coalesce(m.es_prueba,false)
              else ((not coalesce(m.es_prueba,false)) or sgc.is_admin()) end)
    and ( sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid())
          or sgc.submodulo_nivel_explicito('flota.mantenimientos') = any(array['ver','operar']) )
    and (p_vehiculo is null or m.vehiculo_id = p_vehiculo)
    and (p_cursor_fecha is null
         or m.fecha < p_cursor_fecha
         or (m.fecha = p_cursor_fecha and m.id < p_cursor_id))
  order by m.fecha desc, m.id desc
  limit greatest(1, least(coalesce(p_limite, 50), 200));
$function$;

-- 2) Proveedores para flota (picker de taller): antes (not es_prueba). Demo → solo es_prueba.
create or replace function sgc.listar_proveedores_para_flota()
returns table(id uuid, nombre text, tipos text[], es_taller boolean)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select p.id, p.nombre, coalesce(p.tipos,'{}'::text[]) as tipos,
         ('taller' = any(coalesce(p.tipos,'{}'::text[]))) as es_taller
  from sgc.proveedores p
  where coalesce(p.activo, true)
    and (case when sgc.es_usuario_demo() then coalesce(p.es_prueba,false) else not coalesce(p.es_prueba,false) end)
    and (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_flota_elevado()
         or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario')
         or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid()))
  order by ('taller' = any(coalesce(p.tipos,'{}'::text[]))) desc, lower(p.nombre);
$function$;

-- 3) Choferes activos (pickers de conductor): demo → solo conductores de usuarios demo.
create or replace function sgc.choferes_activos()
returns table(conductor_id uuid, nombre text)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select c.id as conductor_id, coalesce(u.nombre, c.nombre) as nombre
  from sgc.conductores c
  left join sgc.usuarios u on u.id = c.usuario_id
  where coalesce(c.activo, true)
    and (not sgc.es_usuario_demo() or sgc.es_usuario_demo(c.usuario_id))
  order by nombre;
$function$;

-- 4) Trabajos de transporte (bandeja de Misael): demo → solo trabajos de obras demo.
create or replace function sgc.trabajos_transporte_listado(p_dia date default null, p_estado text default null, p_conductor_id uuid default null)
returns table(origen text, origen_id uuid, tipo text, descripcion text, proyecto_id uuid, proyecto text, dia date, estado text, conductor_id uuid, conductor text, vehiculo_id uuid, ruta_id uuid, created_at timestamptz)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  with t as (
    select 'apoyo'::text origen, s.id origen_id, s.tipo_apoyo tipo,
           coalesce(s.descripcion, s.que_se_mueve) descripcion, s.proyecto_id,
           s.dia, s.estado, s.conductor_id, null::uuid vehiculo_id, s.ruta_id, s.created_at
      from sgc.solicitudes_movimiento s
     where (case when sgc.es_usuario_demo() then coalesce(s.es_prueba,false) else coalesce(s.es_prueba,false) = false end)
    union all
    select 'requisicion'::text, si.id, 'conduce'::text,
           'Conduce por asignar', si.proyecto_id,
           si.fecha, 'pendiente'::text, si.conductor_id, si.vehiculo_id, si.ruta_id, si.created_at
      from sgc.salidas_inventario si
     where si.estado = 'despachado' and si.conductor_id is null and si.anulado_por is null
       and (case when sgc.es_usuario_demo() then coalesce(si.es_prueba,false) else coalesce(si.es_prueba,false) = false end)
    union all
    select 'manual'::text, m.id, 'actividad'::text, m.descripcion, m.proyecto_id,
           m.dia, m.estado, m.conductor_id, m.vehiculo_id, m.ruta_id, m.created_at
      from sgc.trabajos_manual m
  )
  select t.origen, t.origen_id, t.tipo, t.descripcion, t.proyecto_id,
         p.nombre, t.dia, t.estado, t.conductor_id, c.nombre, t.vehiculo_id, t.ruta_id, t.created_at
    from t
    left join sgc.proyectos p on p.id = t.proyecto_id
    left join sgc.conductores c on c.id = t.conductor_id
   where sgc.es_flota_elevado()
     and (not sgc.es_usuario_demo()
          or exists (select 1 from sgc.proyectos pd where pd.id = t.proyecto_id and coalesce(pd.es_prueba,false)))
     and (p_dia is null or t.dia = p_dia)
     and (p_estado is null or t.estado = p_estado)
     and (p_conductor_id is null or t.conductor_id = p_conductor_id)
   order by t.created_at desc;
$function$;

-- 5) Mis choferes (panel de monitoreo): demo → solo conductores de usuarios demo.
create or replace function sgc.mis_choferes_panel()
returns table(conductor_id uuid, usuario_id uuid, nombre text, telefono text, estado text, estado_desde timestamptz, trabajos_hoy bigint, en_proceso bigint, vehiculo_en_uso text, ultima_senal timestamptz, bateria integer)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select c.id, c.usuario_id, coalesce(u.nombre, c.nombre)::text, coalesce(c.telefono, u.telefono)::text,
         coalesce(ce.estado, 'sin_estado'), ce.desde,
         (select count(*) from sgc.trabajos_manual m where m.conductor_id = c.id and m.dia = current_date)
           + (select count(*) from sgc.solicitudes_movimiento s where s.conductor_id = c.id and s.dia = current_date),
         (select count(*) from sgc.trabajos_manual m where m.conductor_id = c.id and m.estado='en_proceso')
           + (select count(*) from sgc.solicitudes_movimiento s where s.conductor_id = c.id and s.estado='en_proceso'),
         (select v.placa from sgc.vehiculo_usos uu join sgc.vehiculos v on v.id=uu.vehiculo_id
           where uu.usuario_id = c.usuario_id and uu.fin_at is null order by uu.inicio_at desc limit 1),
         up.capturado_en, up.bateria
    from sgc.conductores c
    left join sgc.usuarios u on u.id = c.usuario_id
    left join sgc.chofer_estado ce on ce.usuario_id = c.usuario_id
    left join sgc.chofer_ultima_posicion up on up.usuario_id = c.usuario_id
   where sgc.es_flota_elevado() and coalesce(c.activo, true)
     and (not sgc.es_usuario_demo() or sgc.es_usuario_demo(c.usuario_id))
   order by case coalesce(ce.estado,'') when 'en_ruta' then 0 else 1 end, coalesce(u.nombre, c.nombre);
$function$;

-- 6) Requisiciones (solicitudes_material, sin es_prueba): política RESTRICTIVA que al demo
--    solo le muestra las de obras demo. Normal para el resto (not es_usuario_demo()).
drop policy if exists "req_demo_solo_demo" on sgc.solicitudes_material;
create policy "req_demo_solo_demo" on sgc.solicitudes_material
  as restrictive for select to authenticated
  using (
    (not sgc.es_usuario_demo())
    or exists (select 1 from sgc.proyectos p where p.id = solicitudes_material.proyecto_id and coalesce(p.es_prueba,false))
  );

commit;
