-- =============================================================================
-- PROMPT-13 FASE 2 (AJ6) — Elegibilidad server-side de DESPACHANTES y RECEPTORES.
-- Ronda 08/08/2026 (IDs AJ). SGC padre. Aditivo, idempotente, retrocompatible.
--
-- Problema (capturas v1.67): en el selector de "despachante" salía TODO el mundo
-- (Angelica, el CEO, Xaviel, oficina). El despachante es gente de obra/almacén.
--
-- Criterio aprobado por Xaviel (opción "por rol operativo + vínculo"):
--   Elegible como despachante = usuario/empleado ACTIVO que además cumpla:
--     (a) tiene al menos un ROL operativo de obra/almacén, o
--     (b) su CARGO (empleados) coincide con palabras clave operativas, o
--     (c) tiene el flag manual `puede_despachar` (excepciones puntuales).
--   Se EXCLUYE oficina (admin, tecnología, dirección, gerencias de oficina, RRHH,
--   compras, abogado, ing. de oficina) por no tener rol operativo.
--   El criterio es CONFIGURABLE por parámetros (no hardcode).
--   `es_prueba`: los empleados de prueba no aparecen salvo admin; además el admin
--   ve un usuario test designado (parámetro), para poder probar flujos.
--   Cuando se pasa el origen (bodega/obra), la gente vinculada a ESE destino sale
--   primero (columna `vinculado`).
--
-- También: `receptores_disponibles(...)` para que el selector de receptor no
-- muestre "todo el mundo" (solo responsables del destino + quienes pueden confirmar).
-- =============================================================================

begin;

-- ── 0) Flag manual de excepción + parámetros del criterio ────────────────────
alter table sgc.usuarios  add column if not exists puede_despachar boolean not null default false;
alter table sgc.empleados add column if not exists puede_despachar boolean not null default false;
comment on column sgc.usuarios.puede_despachar  is 'AJ6 — override manual: puede figurar como despachante de conduce.';
comment on column sgc.empleados.puede_despachar is 'AJ6 — override manual: puede figurar como despachante de conduce.';

insert into sgc.parametros (clave, valor, descripcion) values
  ('despachante_roles_elegibles',
   'chofer_transportista,capataz,ingeniero_campo,guarda_almacen,logistica,gerente_produccion',
   'AJ6 — roles cuyos usuarios pueden ser despachante de conduce (CSV de roles.codigo).'),
  ('despachante_cargo_keywords',
   'almacen,bodega,capataz,encargado,ingenier,chofer,transport,maestro,logist',
   'AJ6 — palabras clave de cargo (empleados) elegibles como despachante (CSV, match por ILIKE).'),
  ('despachante_test_user_id', '',
   'AJ6 — usuario de prueba que el admin ve además en el selector de despachante (uuid, opcional).')
on conflict (clave) do nothing;

-- helper: lee un parámetro como array de textos (CSV), con fallback.
create or replace function sgc.param_csv(p_clave text, p_fallback text)
returns text[]
language sql stable
set search_path to 'sgc', 'pg_temp'
as $$
  select array(
    select nullif(trim(x),'')
    from regexp_split_to_table(coalesce((select valor from sgc.parametros where clave = p_clave), p_fallback), ',') x
    where nullif(trim(x),'') is not null
  );
$$;
grant execute on function sgc.param_csv(text, text) to authenticated, service_role;

-- ── 1) despachantes_disponibles(origen) — filtrado + priorizado ──────────────
drop function if exists sgc.despachantes_disponibles();
drop function if exists sgc.despachantes_disponibles(uuid, uuid);
create or replace function sgc.despachantes_disponibles(
  p_bodega_id   uuid default null,
  p_proyecto_id uuid default null
) returns table (tipo text, id uuid, nombre text, detalle text, vinculado boolean)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_admin   boolean := sgc.is_admin();
  v_roles   text[]  := sgc.param_csv('despachante_roles_elegibles',
    'chofer_transportista,capataz,ingeniero_campo,guarda_almacen,logistica,gerente_produccion');
  v_kw      text[]  := sgc.param_csv('despachante_cargo_keywords',
    'almacen,bodega,capataz,encargado,ingenier,chofer,transport,maestro,logist');
  v_test    uuid    := nullif((select valor from sgc.parametros where clave='despachante_test_user_id'),'')::uuid;
  v_proy    uuid    := coalesce(p_proyecto_id, (select proyecto_id from sgc.bodegas bb where bb.id = p_bodega_id));
begin
  return query
  -- Usuarios con cuenta
  select 'usuario'::text, u.id, u.nombre::text,
         (select string_agg(r.nombre, ', ') from sgc.usuarios_roles ur
            join sgc.roles r on r.id = ur.rol_id where ur.usuario_id = u.id) as detalle,
         (v_proy is not null and (
            exists (select 1 from sgc.proyecto_responsables pr
                      where pr.proyecto_id = v_proy and pr.usuario_id = u.id and coalesce(pr.activo,true))
            or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
                      where pe.proyecto_id = v_proy and e.usuario_id = u.id and coalesce(pe.activo,true))
         )) as vinculado
  from sgc.usuarios u
  where coalesce(u.activo, true)
    and (
      u.puede_despachar
      or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = u.id and r.codigo = any(v_roles))
      or (v_admin and v_test is not null and u.id = v_test)
    )
  union all
  -- Empleados del roster (incl. externos sin cuenta)
  select 'empleado'::text, e.id, e.nombre::text, e.cargo::text,
         (v_proy is not null and exists (
            select 1 from sgc.proyecto_empleados pe
            where pe.proyecto_id = v_proy and pe.empleado_id = e.id and coalesce(pe.activo,true))) as vinculado
  from sgc.empleados e
  where coalesce(e.activo, true)
    and ((not coalesce(e.es_prueba, false)) or v_admin)
    and (
      e.puede_despachar
      or exists (select 1 from unnest(v_kw) k where e.cargo ilike '%'||k||'%')
    )
  order by vinculado desc, 3;  -- vinculados primero, luego por nombre
end;
$$;
grant execute on function sgc.despachantes_disponibles(uuid, uuid) to authenticated, service_role;

-- ── 2) receptores_disponibles(destino) — responsables + quien puede confirmar ─
-- Solo usuarios con sesión (el receptor confirma desde SU dispositivo). No "todos".
create or replace function sgc.receptores_disponibles(
  p_proyecto_id uuid default null,
  p_bodega_id   uuid default null
) returns table (id uuid, nombre text, detalle text, vinculado boolean)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_proy uuid := coalesce(p_proyecto_id, (select proyecto_id from sgc.bodegas bb where bb.id = p_bodega_id));
begin
  return query
  with cand as (
    -- Responsables/residentes del proyecto (vinculados)
    select pr.usuario_id as uid, 'Responsable de obra'::text as det, true as vinc
      from sgc.proyecto_responsables pr
      where v_proy is not null and pr.proyecto_id = v_proy and coalesce(pr.activo,true) and pr.usuario_id is not null
    union all
    -- Empleados del proyecto con cuenta (vinculados)
    select e.usuario_id, coalesce(pe.rol,'Empleado de obra'), true
      from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
      where v_proy is not null and pe.proyecto_id = v_proy and coalesce(pe.activo,true) and e.usuario_id is not null
    union all
    -- Quien tiene permiso de confirmar recepción (no vinculado a este destino)
    select u.id, 'Puede confirmar recepción', false
      from sgc.usuarios u where coalesce(u.activo,true) and coalesce(u.can_confirm_reception,false)
    union all
    select ur.usuario_id, 'Ingeniero de campo / Guarda-almacén', false
      from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where r.codigo in ('ingeniero_campo','guarda_almacen')
  )
  select agg.uid, u.nombre::text, agg.det, agg.vinc
  from (select c.uid, min(c.det) as det, bool_or(c.vinc) as vinc
        from cand c group by c.uid) agg
  join sgc.usuarios u on u.id = agg.uid
  where coalesce(u.activo, true)
  order by agg.vinc desc, u.nombre;
end;
$$;
grant execute on function sgc.receptores_disponibles(uuid, uuid) to authenticated, service_role;

commit;
