-- =============================================================================
-- PROMPT-7 FASE 1 (AV1 + AV8) — Elegibilidad del DESPACHANTE: una sola matriz
-- leída por SELECTOR + PANTALLA + SERVIDOR. Ronda 24/08/2026 (IDs AV).
-- SGC padre. Aditivo, idempotente, retrocompatible. Ningún dato se pierde.
--
-- Problemas (capturas v1.88):
--   AV1) El selector de "Despachante" ofrece CHOFERES (Papo quedó de despachante en
--        conduces reales) y el chofer llega hasta el pad de firma para que el
--        servidor lo rechace ("No tienes permiso para firmar este conduce").
--   AV8) Un Gerente_proyectos (Test User 3) NO aparece en el selector aunque debería.
--
-- Causa raíz (verificada contra prod):
--   (a) El parámetro `despachante_roles_elegibles` incluía `chofer_transportista`
--       (→ AV1) y NO incluía `gerente_proyectos` (→ AV8).
--   (b) BUG real del servidor: `conduce_firmar_despachante` valida que el firmante
--       sea el despachante designado (bien), pero delega en `firmar_conduce`, cuya
--       whitelist NO contempla al despachante → rechaza a CUALQUIER despachante que
--       no tenga además módulo inventario / no sea creador / receptor / conductor.
--       Por eso hay 4 conduces REALES atascados con despachantes ELEGIBLES
--       (Emmanuel=ingeniero_campo, Sócrates y Jonathan=gerente_proyectos): no es
--       inelegibilidad, es este bug. Se destraban solos al corregirlo.
--
-- Diseño: `sgc.es_despachante_elegible(uuid)` = ÚNICA fuente de verdad (lee el
--   parámetro). La consumen el selector (`despachantes_disponibles`), el servidor
--   (`firmar_conduce` + `conduce_firmar_despachante`) y la pantalla
--   (`mis_conduces_por_firmar` expone `despachante_elegible`). Defensa en profundidad:
--   un inelegible NUNCA llega a dibujar la firma; ve "corrección pendiente".
--
-- ⚠️ Lista de roles elegibles: procede de la decisión de Xaviel (opción "quitar solo
--   Chofer" + AV8 exige agregar gerente_proyectos). Queda PARAMETRIZADA: se ajusta sin
--   código desde sgc.parametros.despachante_roles_elegibles.
-- =============================================================================

begin;

-- ── 1) Actualizar la lista de roles elegibles (UPDATE, no INSERT: el param ya existe)
--    Quita chofer_transportista (AV1). Agrega gerente_proyectos (AV8), jefe_flota y
--    admin (roles de gestión que legítimamente despachan). El resto se conserva.
update sgc.parametros
   set valor = 'capataz,ingeniero_campo,guarda_almacen,logistica,gerente_produccion,gerente_proyectos,jefe_flota,admin',
       descripcion = 'AV1/AV8 — roles cuyos usuarios pueden ser despachante de conduce (CSV de roles.codigo). Chofer FUERA.'
 where clave = 'despachante_roles_elegibles';

-- Si por alguna razón no existiera, lo sembramos con el valor correcto.
insert into sgc.parametros (clave, valor, descripcion)
select 'despachante_roles_elegibles',
       'capataz,ingeniero_campo,guarda_almacen,logistica,gerente_produccion,gerente_proyectos,jefe_flota,admin',
       'AV1/AV8 — roles cuyos usuarios pueden ser despachante de conduce (CSV de roles.codigo). Chofer FUERA.'
where not exists (select 1 from sgc.parametros where clave = 'despachante_roles_elegibles');

-- ── 2) MATRIZ ÚNICA de elegibilidad del despachante (fuente de verdad) ─────────
-- Un usuario es elegible si (a) tiene el flag manual puede_despachar, o (b) tiene
-- al menos un rol de la lista parametrizada. `es_prueba`: usuarios no tienen esa
-- columna (los de prueba son usuarios reales); el aislamiento de prueba de la app
-- se maneja aparte (despachante_test_user_id en el selector).
create or replace function sgc.es_despachante_elegible(p_usuario_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p_usuario_id is not null and (
    exists (select 1 from sgc.usuarios u where u.id = p_usuario_id and coalesce(u.puede_despachar, false))
    or exists (
      select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = p_usuario_id
        and r.codigo = any (sgc.param_csv(
          'despachante_roles_elegibles',
          'capataz,ingeniero_campo,guarda_almacen,logistica,gerente_produccion,gerente_proyectos,jefe_flota,admin'))
    )
  );
$$;
grant execute on function sgc.es_despachante_elegible(uuid) to authenticated, service_role;

-- ── 3) SELECTOR: despachantes_disponibles lee la matriz (DRY) ─────────────────
-- Misma firma y forma; la rama de usuarios ahora delega en es_despachante_elegible.
create or replace function sgc.despachantes_disponibles(
  p_bodega_id   uuid default null,
  p_proyecto_id uuid default null
) returns table (tipo text, id uuid, nombre text, detalle text, vinculado boolean)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_admin   boolean := sgc.is_admin();
  v_kw      text[]  := sgc.param_csv('despachante_cargo_keywords',
    'almacen,bodega,capataz,encargado,ingenier,transport,maestro,logist');
  v_test    uuid    := nullif((select valor from sgc.parametros where clave='despachante_test_user_id'),'')::uuid;
  v_proy    uuid    := coalesce(p_proyecto_id, (select proyecto_id from sgc.bodegas bb where bb.id = p_bodega_id));
begin
  return query
  -- Usuarios con cuenta: elegibilidad por la matriz única.
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
      sgc.es_despachante_elegible(u.id)
      or (v_admin and v_test is not null and u.id = v_test)
    )
  union all
  -- Empleados del roster (incl. externos sin cuenta): por cargo. NOTA: 'chofer' se
  -- retiró de las keywords (AV1) para no colar transportistas por su cargo.
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
  order by vinculado desc, 3;
end;
$$;
grant execute on function sgc.despachantes_disponibles(uuid, uuid) to authenticated, service_role;

-- Retirar 'chofer' de las keywords de cargo (empleados) para no colar transportistas.
update sgc.parametros
   set valor = 'almacen,bodega,capataz,encargado,ingenier,transport,maestro,logist'
 where clave = 'despachante_cargo_keywords'
   and valor like '%chofer%';

-- ── 4) SERVIDOR (bug fix): firmar_conduce acepta al despachante designado ELEGIBLE
-- Se preserva el cuerpo vigente (ah4b) y SOLO se amplía la whitelist con el
-- despachante designado, gateado por la matriz (defensa en profundidad: un chofer
-- designado por datos viejos sigue siendo rechazado).
create or replace function sgc.firmar_conduce(p_salida_id uuid, p_rol text, p_nombre text, p_firma_path text, p_cedula text default null::text, p_rol_desc text default null::text, p_metodo text default 'pad'::text, p_usuario_id uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
  v_pend uuid;
  v_pend_alm boolean;
  v_creador uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor','transportista') then raise exception 'Rol de firma inválido'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El nombre de quien firma es obligatorio'; end if;
  if nullif(p_firma_path,'') is null then raise exception 'Falta la imagen de la firma'; end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.salidas_inventario s
      where s.id = p_salida_id
        and (s.creado_por = v_uid
             or s.firma_pendiente_usuario_id = v_uid
             or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid)
             -- AV1: el despachante designado ELEGIBLE puede firmar (rol 'emisor').
             or (s.despachante_usuario_id = v_uid and sgc.es_despachante_elegible(v_uid)))
    )
  ) then
    raise exception 'No tienes permiso para firmar este conduce';
  end if;

  if v_rol = 'receptor' then
    select firma_pendiente_usuario_id, firma_pendiente_almacen, creado_por
      into v_pend, v_pend_alm, v_creador
      from sgc.salidas_inventario where id = p_salida_id;
  end if;

  insert into sgc.salida_firmas (salida_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
  values (p_salida_id, v_rol, trim(p_nombre), nullif(p_cedula,''), nullif(p_rol_desc,''),
          coalesce(p_usuario_id, case when v_rol='receptor' then v_uid else null end), p_firma_path,
          coalesce(nullif(p_metodo,''),'pad'))
  on conflict (salida_id, rol) do update
    set nombre = excluded.nombre, cedula = excluded.cedula, rol_desc = excluded.rol_desc,
        usuario_id = excluded.usuario_id, firma_path = excluded.firma_path,
        metodo = excluded.metodo, firmado_en = now()
  returning id into v_id;

  if v_rol = 'receptor' then
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null, firma_pendiente_almacen = false
     where id = p_salida_id;

    if (v_pend is not null or coalesce(v_pend_alm,false)) and v_creador is not null and v_creador <> v_uid then
      perform sgc.notificar(v_creador, 'firma',
        'Firma de recepción completada',
        format('%s confirmó la entrega que habías dejado pendiente.', trim(p_nombre)),
        '/transporte/conduces');
    end if;
  end if;

  return v_id;
end;
$function$;

-- ── 5) SERVIDOR: conduce_firmar_despachante rechaza al inelegible con mensaje claro
-- (para que la UI muestre "corrección pendiente" sin dejar dibujar la firma).
create or replace function sgc.conduce_firmar_despachante(
  p_salida_id uuid,
  p_firma_path text
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma es obligatoria.';
  end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  if v_s.despachante_usuario_id is null then
    raise exception 'Este conduce no tiene un despachante del sistema para firmar.';
  end if;
  -- Anti-suplantación: sólo el despachante designado firma, desde SU sesión.
  if v_s.despachante_usuario_id <> v_uid then
    raise exception 'Sólo el despachante designado puede firmar este conduce, desde su propia sesión.';
  end if;
  -- AV1: elegibilidad (misma matriz). Un despachante inelegible (p.ej. chofer por
  -- datos viejos) NO firma: el conduce requiere corrección (reasignar despachante).
  if not sgc.es_despachante_elegible(v_uid) then
    raise exception 'DESP_INELEGIBLE: Tu rol no está habilitado para firmar conduces como despachante. Este conduce necesita corrección: pide a un almacenista o al administrador que reasigne el despachante.';
  end if;
  if exists (select 1 from sgc.salida_firmas sf where sf.salida_id = p_salida_id and sf.rol = 'emisor') then
    return 'ya_firmado';
  end if;

  select coalesce(nullif(v_s.despachante_nombre,''), u.nombre, 'Despachante')
    into v_nombre from sgc.usuarios u where u.id = v_uid;

  perform sgc.firmar_conduce(
    p_salida_id, 'emisor', coalesce(v_nombre,'Despachante'),
    p_firma_path, null, 'Despachante', 'pad', v_uid);

  if v_s.creado_por is distinct from v_uid then
    perform sgc.notificar(
      v_s.creado_por, 'conduce',
      'Conduce firmado por el despachante',
      'El despachante firmó el conduce '||('CND-'||upper(left(p_salida_id::text,8)))||'. Ya puedes marcar la entrega.',
      '/transporte/mis-conduces');
  end if;

  return 'firmado';
end;
$$;
grant execute on function sgc.conduce_firmar_despachante(uuid, text) to authenticated, service_role;

-- ── 6) PANTALLA: la bandeja expone si el despachante actual es elegible, para
-- mostrar "corrección pendiente" en vez del pad. Se agrega la columna al final.
-- El _count depende de esta función → se dropea primero y se recrea después.
drop function if exists sgc.mis_conduces_por_firmar_count();
drop function if exists sgc.mis_conduces_por_firmar();
create or replace function sgc.mis_conduces_por_firmar()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, created_at timestamptz, despachante_elegible boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id,
         coalesce(p.nombre, da.nombre) as destino, b.nombre as bodega,
         s.estado, sgc.conduce_fase(s.id), s.created_at,
         sgc.es_despachante_elegible(auth.uid()) as despachante_elegible
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.bodegas   da on da.id = s.destino_almacen_id
  where s.despachante_usuario_id = auth.uid()
    and coalesce(s.estado,'') <> 'anulado'
    and not exists (select 1 from sgc.salida_firmas sf where sf.salida_id = s.id and sf.rol = 'emisor')
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
  order by s.created_at desc;
$$;
grant execute on function sgc.mis_conduces_por_firmar() to authenticated, service_role;

create or replace function sgc.mis_conduces_por_firmar_count()
returns integer language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$ select count(*)::int from sgc.mis_conduces_por_firmar(); $$;
grant execute on function sgc.mis_conduces_por_firmar_count() to authenticated, service_role;

commit;
