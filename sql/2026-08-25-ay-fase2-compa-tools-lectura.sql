-- ============================================================================
-- AY FASE 2 — Compa C1: cobertura de tools de LECTURA (AY9).
--
-- Cada RPC: (a) SECURITY DEFINER pero filtrado por la identidad/permisos del
-- usuario (auth.uid() / tiene_modulo / puede_*) — nunca "a pelo"; (b) respeta
-- es_prueba donde el dato lo tiene; (c) reutiliza lo existente. El edge
-- (`toolsParaUsuario`) además filtra el tool por módulo → un rol sin el módulo
-- ni siquiera ve la herramienta.
--
-- REUTILIZA (no se recrean): flota_placas, vehiculos_en_uso, inventario_almacen,
-- ultimos_movimientos_articulo, incentivo_listado, kpi_proyectos, listar_cronograma,
-- personal_obra_conteos. Solo se CREAN los 4 que no existían + mis_permisos.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ── mis_permisos() — "¿tengo acceso a X?" leyendo la matriz REAL del usuario ─
-- A diferencia de accesos_efectivos_usuario (admin-only, AN4), esto es de LO
-- PROPIO: cualquiera puede leer sus propios accesos. Devuelve módulos, el mejor
-- nivel por submódulo explícito, roles y es_admin. Compa lo usa para responder
-- "¿tengo acceso a Compras?" con datos, no deduciendo del perfil (hallazgo 5).
create or replace function sgc.mis_permisos()
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid  uuid := auth.uid();
  v_mods text[];
  v_subs jsonb := '{}'::jsonb;
  v_roles jsonb;
  r record; k text; v text; cur text;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;

  select coalesce(array_agg(distinct m), array[]::text[]) into v_mods
  from sgc.usuarios_roles ur join sgc.roles rr on rr.id = ur.rol_id, unnest(rr.modulos) m
  where ur.usuario_id = v_uid;

  for r in
    select rr.permisos from sgc.usuarios_roles ur join sgc.roles rr on rr.id = ur.rol_id
    where ur.usuario_id = v_uid and rr.permisos is not null
  loop
    for k, v in select * from jsonb_each_text(r.permisos) loop
      cur := v_subs->>k;
      if v = 'operar' or (v = 'ver' and coalesce(cur,'') <> 'operar') then
        v_subs := jsonb_set(v_subs, array[k], to_jsonb(v));
      end if;
    end loop;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('codigo', rr.codigo, 'nombre', rr.nombre) order by rr.nombre), '[]'::jsonb)
    into v_roles
  from sgc.usuarios_roles ur join sgc.roles rr on rr.id = ur.rol_id
  where ur.usuario_id = v_uid;

  return jsonb_build_object(
    'es_admin', sgc.is_admin(),
    'modulos', to_jsonb(coalesce(v_mods, array[]::text[])),
    'submodulos', v_subs,
    'roles', v_roles
  );
end;
$$;
grant execute on function sgc.mis_permisos() to authenticated, service_role;

-- ── resumen_flota() — conteos de la flota (módulo flota) ────────────────────
create or replace function sgc.resumen_flota()
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_admin boolean := sgc.is_admin();
begin
  if not (v_admin or sgc.tiene_modulo('flota')) then
    raise exception 'Sin acceso a flota' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total',            (select count(*) from sgc.vehiculos v where v_admin or not coalesce(v.es_prueba,false)),
    'activos',          (select count(*) from sgc.vehiculos v where v.estado='activo'        and (v_admin or not coalesce(v.es_prueba,false))),
    'en_mantenimiento', (select count(*) from sgc.vehiculos v where v.estado='mantenimiento' and (v_admin or not coalesce(v.es_prueba,false))),
    'baja',             (select count(*) from sgc.vehiculos v where v.estado='baja'          and (v_admin or not coalesce(v.es_prueba,false))),
    'en_uso',           (select count(*) from sgc.vehiculo_usos u join sgc.vehiculos v on v.id=u.vehiculo_id
                          where u.fin_at is null and (v_admin or (not coalesce(u.es_prueba,false) and not coalesce(v.es_prueba,false)))),
    'mantenimientos_pendientes', (select count(*) from sgc.mantenimientos m join sgc.vehiculos v on v.id=m.vehiculo_id
                          where m.estado in ('pendiente','en_proceso') and (v_admin or (not coalesce(m.es_prueba,false) and not coalesce(v.es_prueba,false))))
  );
end;
$$;
grant execute on function sgc.resumen_flota() to authenticated, service_role;

-- ── mantenimientos_pendientes() — lista global (módulo flota) ───────────────
create or replace function sgc.mantenimientos_pendientes()
returns table(id uuid, vehiculo_id uuid, placa text, marca text, tipo text,
              descripcion text, fecha date, estado text, kilometraje int)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_admin boolean := sgc.is_admin();
begin
  if not (v_admin or sgc.tiene_modulo('flota')) then
    raise exception 'Sin acceso a flota' using errcode = '42501';
  end if;
  return query
  select m.id, m.vehiculo_id, v.placa::text, v.marca::text, m.tipo::text,
         m.descripcion::text, m.fecha::date, m.estado::text, m.kilometraje_al_mantenimiento::int
  from sgc.mantenimientos m join sgc.vehiculos v on v.id = m.vehiculo_id
  where m.estado in ('pendiente','en_proceso')
    and (v_admin or (not coalesce(m.es_prueba,false) and not coalesce(v.es_prueba,false)))
  order by m.fecha nulls last, m.created_at desc;
end;
$$;
grant execute on function sgc.mantenimientos_pendientes() to authenticated, service_role;

-- ── articulos_bajo_minimo(bodega) — reutiliza inventario_almacen ────────────
-- inventario_almacen ya calcula la existencia y valida el permiso de la bodega
-- (raise 42501 si no); esta función solo filtra cantidad < stock_minimo. Como es
-- una llamada anidada, auth.uid() se conserva → el permiso de bodega aplica.
create or replace function sgc.articulos_bajo_minimo(p_bodega_id uuid)
returns table(articulo_id uuid, codigo text, nombre text, unidad text,
              cantidad numeric, stock_minimo numeric, faltante numeric)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select ia.articulo_id, ia.codigo::text, ia.nombre::text, ia.unidad::text,
         ia.cantidad::numeric, a.stock_minimo::numeric,
         (a.stock_minimo::numeric - ia.cantidad::numeric) as faltante
  from sgc.inventario_almacen(p_bodega_id, true, null, false) ia
  join sgc.articulos a on a.id = ia.articulo_id
  where coalesce(a.stock_minimo, 0) > 0
    and ia.cantidad::numeric < a.stock_minimo::numeric
  order by (a.stock_minimo::numeric - ia.cantidad::numeric) desc;
$$;
grant execute on function sgc.articulos_bajo_minimo(uuid) to authenticated, service_role;

-- ── desempeno_semana(anio, semana) — wrapper de incentivo_listado ───────────
-- Defaults a la semana ISO actual. p_incluir_prueba=false (Compa no surtea datos
-- de prueba). incentivo_listado valida puede_gestionar_incentivos() internamente
-- (raise si el rol no lo tiene) → hereda el permiso correcto (AY6: Logística con
-- módulo 'incentivos' pasa; el resto recibe el error traducido por el edge).
create or replace function sgc.desempeno_semana(p_anio int default null, p_semana int default null)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from sgc.incentivo_listado(
    coalesce(p_anio,   extract(isoyear from current_date)::int),
    coalesce(p_semana, extract(week    from current_date)::int),
    false
  ) t;
$$;
grant execute on function sgc.desempeno_semana(int, int) to authenticated, service_role;

-- ── capacidades_asistente() — incluir el módulo 'incentivos' en el escaneo ──
-- Sin esto, cap.modulos nunca contiene 'incentivos' y el tool desempeno_semana
-- (gate ['incentivos']) jamás se le ofrecería a un rol que sí lo tiene (AY6).
create or replace function sgc.capacidades_asistente()
 returns jsonb
 language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_nombre text;
  v_admin  boolean;
  v_mods   text[] := '{}';
  m        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select nombre into v_nombre from sgc.usuarios where id = v_uid;
  v_admin := sgc.is_admin();
  foreach m in array array['inventario','compras','rrhh','proyectos','flota',
                           'bitacora','documentos','plantillas','legal','tareas',
                           'tecnologia','direccion','incentivos','admin'] loop
    if v_admin or sgc.tiene_modulo(m) then v_mods := v_mods || m; end if;
  end loop;
  return jsonb_build_object(
    'usuario_id', v_uid,
    'nombre', coalesce(v_nombre, 'Usuario'),
    'es_admin', v_admin,
    'modulos', to_jsonb(v_mods),
    'puede_ver_todas_requisiciones', sgc.puede_ver_todas_requisiciones()
  );
end;
$function$;
grant execute on function sgc.capacidades_asistente() to authenticated;

commit;
