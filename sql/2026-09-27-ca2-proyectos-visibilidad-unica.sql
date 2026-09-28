-- ════════════════════════════════════════════════════════════════════════════
-- CA2 — 🔴 Sócrates (y todo módulo-proyectos) no ve las obras en la APP.
-- Nota #82: "Socrates still cant see the obras, u can join using the feature
-- 'Entrar como' in order to know what happens with these errors. lets check it."
-- ════════════════════════════════════════════════════════════════════════════
-- CAUSA (regla 14 — dos predicados para el MISMO dato):
--   • WEB lee `.from('proyectos')` bajo la RLS `proyectos: select` (bj5) que es AMPLIA:
--     is_admin OR tiene_modulo(proyectos|inventario|compras|direccion|transporte|flota)
--     OR proyectos.obras OR responsable/capataz/empleado OR red AW1. → Sócrates
--     (gerente_proyectos = módulo proyectos) ve TODAS en la web.
--   • APP llama al RPC `mis_proyectos()` (ad) que es ESTRECHO: solo responsable_id o
--     proyecto_empleados — IGNORA el módulo proyectos. → Sócrates no es responsable de
--     casi ninguna obra → la app le muestra VACÍO (y de ahí BY4: sin obras no hay
--     bitácoras que abrir).
--
-- FIX (una sola fuente de verdad): `sgc.puede_ver_proyecto(p_proyecto, p_usuario)` con
--   TODAS las ramas de la RLS bj5. La política `proyectos: select` y `mis_proyectos`
--   la usan. `mis_proyectos(p_usuario, p_todos)`:
--     · p_todos = null/true → todo lo que puede_ver_proyecto (lista principal de la app);
--     · p_todos = false     → solo las suyas (bloque "Mis obras").
--   Cada fila marca `es_mia` (responsable/residente/empleado) para separar
--   *Mis obras* / *Otras obras* en la app. `es_prueba` sigue solo admin.
--
-- Compañero (regla 14): se nombra `puede_ver_echada` para `registros_combustible` (hoy
--   el predicado vive inline en la política select y en `echada_detalle` — BZ1) para que
--   el lint `verify-regresiones` pueda exigir "política == RPC" en las TRES tablas de la
--   semana (proyectos, bitacoras, registros_combustible). Extracción pura, sin cambio de
--   comportamiento.
--
-- ADITIVO / retrocompatible. No quita visibilidad a ningún rol (puede_ver_proyecto
--   contiene exactamente las ramas de bj5). Rollback: `mis_proyectos` vuelve a la versión
--   `ad` (1 arg), la política select a bj5, y se dropean puede_ver_proyecto / es_mia_proyecto
--   / puede_ver_echada (restaurando el predicado inline en la política de combustible).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-27-ca2-proyectos-visibilidad-unica.sql --env dev  →  --env prod --yes
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local search_path = sgc, public;

-- ── 1) "¿Es MÍA esta obra?" (vínculo personal, parametrizable por usuario) ────
-- responsable_id o proyecto_responsables (cualquier tipo, activo) — vía
-- es_responsable_de_proyecto (aq8) — o empleado del proyecto. SECURITY DEFINER
-- (bypassa RLS de las tablas puente). Es lo que marca `es_mia` y el bloque "Mis obras".
create or replace function sgc.es_mia_proyecto(p_proyecto uuid, p_usuario uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p_proyecto is not null and p_usuario is not null and (
    sgc.es_responsable_de_proyecto(p_proyecto, p_usuario)
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = p_proyecto and e.usuario_id = p_usuario
    )
  );
$$;
grant execute on function sgc.es_mia_proyecto(uuid, uuid) to authenticated, service_role;

-- ── 2) Predicado ÚNICO de visibilidad de proyecto (fuente de la RLS y del RPC) ─
-- Contiene TODAS las ramas de la política bj5. Las ramas "amplias" (módulo/submódulo/
-- capataz/red AW1) son del USUARIO ACTUAL (auth-based, no parametrizables), así que solo
-- aplican cuando se pregunta por uno mismo (p_usuario = auth.uid()); el vínculo personal
-- (es_mia) sí se evalúa para p_usuario. SECURITY DEFINER = mismo blindaje anti-recursión
-- que bj5 (usuario_sin_obra_activa_ligada hace `select from proyectos`).
create or replace function sgc.puede_ver_proyecto(p_proyecto uuid, p_usuario uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    -- Vínculo directo con la obra (para cualquier usuario consultado).
    sgc.es_mia_proyecto(p_proyecto, p_usuario)
    -- Visibilidad AMPLIA por rol/módulo: solo del usuario actual (auth-based).
    or (
      p_usuario = auth.uid() and (
        sgc.is_admin()
        or sgc.tiene_modulo('proyectos')
        or sgc.tiene_modulo('inventario')
        or sgc.tiene_modulo('compras')
        or sgc.tiene_modulo('direccion')
        or sgc.tiene_modulo('transporte')
        or sgc.tiene_modulo('flota')
        or sgc.puede_ver_submodulo('proyectos.obras')
        or sgc.es_capataz_de_proyecto(p_proyecto)
        or sgc.usuario_sin_obra_activa_ligada()   -- red AW1: sin obra ligada → ve todas
      )
    );
$$;
grant execute on function sgc.puede_ver_proyecto(uuid, uuid) to authenticated, service_role;
comment on function sgc.puede_ver_proyecto(uuid, uuid) is
  'CA2 — predicado ÚNICO de visibilidad de proyecto (regla 14). Fuente de la política '
  '"proyectos: select" y del RPC mis_proyectos. Ramas amplias (módulo/submódulo/capataz/'
  'red AW1) solo para el usuario actual; el vínculo personal (es_mia_proyecto) para cualquiera. '
  'es_prueba se resuelve aparte (policy RESTRICTIVE / filtro en mis_proyectos).';

-- ── 3) La RLS `proyectos: select` pasa a usar el predicado único ──────────────
-- Equivalente EXACTO a bj5 (puede_ver_proyecto con auth.uid() = todas las ramas de bj5).
drop policy if exists "proyectos: select" on sgc.proyectos;
create policy "proyectos: select" on sgc.proyectos
  for select using ( sgc.puede_ver_proyecto(proyectos.id) );

-- ── 4) mis_proyectos(p_usuario, p_todos) — mismo predicado que la RLS ─────────
-- Se dropea la firma vieja (1 arg) para no dejar overload ambiguo con la nueva
-- (2 args, ambos con default → mis_proyectos() sería ambiguo — gotcha BW).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'sgc' and p.proname = 'mis_proyectos'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- `create or replace` (tras el drop de la firma vieja): así el lint verify-regresiones,
-- que busca `create or replace function`, ve esta definición como la VIVA.
create or replace function sgc.mis_proyectos(p_usuario uuid default null, p_todos boolean default null)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with target as (
    -- No-admin solo puede consultarse a sí mismo; admin puede consultar a cualquiera.
    select case when sgc.is_admin() then coalesce(p_usuario, auth.uid()) else auth.uid() end as uid
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.es_mia desc, t.codigo), '[]'::jsonb)
  from (
    select p.*,
      coalesce(
        (select jsonb_agg(to_jsonb(f) order by f.orden nulls last, f.created_at)
         from sgc.fases_proyecto f where f.proyecto_id = p.id),
        '[]'::jsonb
      ) as fases,
      enc.encargado_id,
      enc.encargado_nombre,
      sgc.es_mia_proyecto(p.id, target.uid) as es_mia
    from sgc.proyectos p, target
    left join lateral (
      select u.id as encargado_id, u.nombre as encargado_nombre
      from sgc.usuarios u
      where u.id = coalesce(
        p.responsable_id,
        (select pr.usuario_id from sgc.proyecto_responsables pr
          where pr.proyecto_id = p.id and coalesce(pr.activo, true)
          order by pr.es_principal desc,
                   case pr.tipo_responsabilidad when 'responsable' then 0 when 'residente' then 1 else 2 end,
                   pr.desde nulls last
          limit 1)
      )
      limit 1
    ) enc on true
    where p.activo = true
      and (not coalesce(p.es_prueba, false) or sgc.is_admin())  -- prueba: solo admin
      and (
        case when p_todos is false
          then sgc.es_mia_proyecto(p.id, target.uid)          -- "Mis obras"
          else sgc.puede_ver_proyecto(p.id, target.uid)       -- todo lo visible
        end
      )
  ) t;
$function$;
grant execute on function sgc.mis_proyectos(uuid, boolean) to authenticated, service_role;
comment on function sgc.mis_proyectos(uuid, boolean) is
  'CA2 — proyectos visibles para el usuario, MISMO predicado que la RLS (puede_ver_proyecto). '
  'p_todos=null/true → todo lo visible (lista de la app); p_todos=false → solo las suyas '
  '(bloque Mis obras). Cada fila trae es_mia (responsable/residente/empleado). es_prueba solo admin.';

-- ── 5) Compañero (regla 14): nombrar el predicado de echada (registros_combustible) ─
-- BZ1 unificó política↔echada_detalle pero INLINE. Lo nombramos para que el lint pueda
-- exigir "política == RPC" también aquí. Mismo predicado, extracción pura.
create or replace function sgc.puede_ver_echada(p_registrado_por uuid, p_conductor_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.es_flota_elevado() or sgc.is_admin()
      or p_registrado_por = auth.uid()
      or (p_conductor_id in (select sgc.mis_conductor_ids()));
$$;
grant execute on function sgc.puede_ver_echada(uuid, uuid) to authenticated, service_role;

drop policy if exists "registros_combustible: select" on sgc.registros_combustible;
create policy "registros_combustible: select" on sgc.registros_combustible
  for select to authenticated
  using ( sgc.puede_ver_echada(registrado_por, conductor_id) );

-- echada_detalle (BZ1) pasa a usar el predicado nombrado (misma semántica). Así la
-- política select y el RPC de detalle referencian la MISMA función (lo que exige el lint).
create or replace function sgc.echada_detalle(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_r   sgc.registros_combustible%rowtype;
  v_out jsonb;
begin
  select * into v_r from sgc.registros_combustible where id = p_id;
  if not found then
    return null;  -- paridad con maybeSingle(): fila inexistente → null, no error
  end if;

  -- Gate = mismo predicado que la política select de la tabla (puede_ver_echada).
  if not sgc.puede_ver_echada(v_r.registrado_por, v_r.conductor_id) then
    raise exception 'No autorizado para ver esta echada.' using errcode = '42501';
  end if;

  select to_jsonb(v_r)
    || jsonb_build_object(
      'vehiculo', case when v_r.vehiculo_id is not null then (
          select jsonb_build_object('placa', v.placa, 'marca', v.marca)
          from sgc.vehiculos v where v.id = v_r.vehiculo_id) end,
      'conductor', case when v_r.conductor_id is not null then (
          select jsonb_build_object('nombre', u.nombre)
          from sgc.conductores c left join sgc.usuarios u on u.id = c.usuario_id
          where c.id = v_r.conductor_id) end,
      'registrador', case when v_r.registrado_por is not null then (
          select jsonb_build_object('nombre', u.nombre)
          from sgc.usuarios u where u.id = v_r.registrado_por) end,
      'revisor', case when v_r.revisada_por is not null then (
          select jsonb_build_object('nombre', u.nombre)
          from sgc.usuarios u where u.id = v_r.revisada_por) end,
      'vehiculo_display', case when v_r.vehiculo_id is not null
          then sgc.vehiculo_display(v_r.vehiculo_id) end,
      'conductor_nombre', (select u.nombre from sgc.conductores c
          left join sgc.usuarios u on u.id = c.usuario_id where c.id = v_r.conductor_id),
      'registrador_nombre', (select nombre from sgc.usuarios where id = v_r.registrado_por),
      'revisada_por_nombre', (select nombre from sgc.usuarios where id = v_r.revisada_por),
      'motivo_revision', sgc.echada_motivo_revision(v_r),
      'historial', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', h.id, 'registro_id', h.registro_id,
                 'antes', h.antes, 'despues', h.despues, 'motivo', h.motivo,
                 'editado_por', h.editado_por, 'editado_como_rol', h.editado_como_rol,
                 'created_at', h.created_at,
                 'editor', jsonb_build_object('nombre', eu.nombre))
               order by h.created_at desc)
        from sgc.registros_combustible_historial h
        left join sgc.usuarios eu on eu.id = h.editado_por
        where h.registro_id = v_r.id), '[]'::jsonb)
    ) into v_out;

  return v_out;
end $fn$;
grant execute on function sgc.echada_detalle(uuid) to authenticated, service_role;

commit;
