-- CE2 + CE16 — Personal de obra: "Registró" visible para todos los roles + duplicados
-- ---------------------------------------------------------------------------------
-- CE2: el nombre de quien registró venía por un EMBED a usuarios bajo RLS
--   (personal-obra.service.ts:89 registrador:usuarios!registrado_por); Sonia (abogado)
--   no lee usuarios → el embed volvía null y la UI pintaba "—".  Fix: RPC definer
--   listar_personal_obra() con el MISMO predicado de la política (puede_ver_personal_obra)
--   que devuelve registrado_por_nombre ya resuelto.  + backfill del único null + trigger
--   (ya existe tg_personal_obra_registrado_por) confirmado.
-- CE16: EDWARD MOTA está dos veces (misma cédula 402-2685801-3 / 4022685801-3).
--   documento_numero_norm ya es generado (solo dígitos).  Aquí: helper doc_normalizado
--   (dígitos para cédula, mayúsculas alfanum para pasaporte), detección y FUSIÓN que
--   conserva fotos y firmas, borrado lógico del descartado.  El índice ÚNICO va en
--   ce16b (tras fusionar los duplicados; en prod lo revisa Xaviel antes).
-- ---------------------------------------------------------------------------------

-- ── (0) Borrado lógico (compartido con CE9) ───────────────────────────────────────
alter table sgc.personal_obra
  add column if not exists eliminado_at    timestamptz,
  add column if not exists eliminado_por   uuid references sgc.usuarios(id),
  add column if not exists eliminado_motivo text;

-- ── (1) CE2 — backfill del registrado_por nulo desde la auditoría ─────────────────
update sgc.personal_obra po
   set registrado_por = a.actor_id
  from sgc.auditoria a
 where po.registrado_por is null
   and a.tabla = 'personal_obra' and a.accion = 'INSERT'
   and a.registro_id = po.id::text and a.actor_id is not null;

-- ── (2) CE2 — listar_personal_obra: definer, mismo predicado + registrado_por_nombre
create or replace function sgc.listar_personal_obra(p_proyecto uuid default null)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(
    to_jsonb(po)
    || jsonb_build_object(
         'cargo', (select jsonb_build_object('id', c.id, 'codigo', c.codigo, 'nombre', c.nombre)
                     from sgc.cargos c where c.id = po.cargo_id),
         'proyecto', (select jsonb_build_object('nombre', p.nombre, 'codigo', p.codigo)
                        from sgc.proyectos p where p.id = po.proyecto_id),
         'registrado_por_nombre', (select u.nombre from sgc.usuarios u where u.id = po.registrado_por)
       )
    order by po.created_at desc), '[]'::jsonb)
  from sgc.personal_obra po
  where (p_proyecto is null or po.proyecto_id = p_proyecto)
    and po.eliminado_at is null
    and sgc.puede_ver_personal_obra(po.proyecto_id);
$function$;
grant execute on function sgc.listar_personal_obra(uuid) to authenticated;

-- ── (3) CE16 — normalización de documento (cédula dígitos / pasaporte alfanum) ────
create or replace function sgc.doc_normalizado(p_tipo text, p_numero text)
returns text
language sql immutable
as $function$
  select nullif(
    case when p_tipo = 'pasaporte'
         then upper(regexp_replace(coalesce(p_numero,''), '[^A-Za-z0-9]', '', 'g'))
         else regexp_replace(coalesce(p_numero,''), '\D', '', 'g')
    end, '');
$function$;

-- ── (4) CE16 — detección de duplicados (mismo documento, activos, no prueba) ──────
create or replace function sgc.personal_obra_duplicados()
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  with activos as (
    select po.*, sgc.doc_normalizado(po.tipo_documento, po.documento_numero) as dn
    from sgc.personal_obra po
    where po.eliminado_at is null and not coalesce(po.es_prueba, false)
      and sgc.doc_normalizado(po.tipo_documento, po.documento_numero) is not null
      and (sgc.is_admin()
           or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                      where ur.usuario_id = auth.uid() and r.codigo in ('legal','abogado'))
           or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh'))
  ),
  dups as (select dn from activos group by dn having count(*) > 1)
  select coalesce(jsonb_agg(g order by g->>'documento'), '[]'::jsonb) from (
    select jsonb_build_object(
      'documento', a.dn,
      'registros', jsonb_agg(jsonb_build_object(
         'id', a.id, 'nombre', a.nombre, 'documento_numero', a.documento_numero,
         'tipo_documento', a.tipo_documento, 'proyecto_id', a.proyecto_id,
         'proyecto', (select p.nombre from sgc.proyectos p where p.id = a.proyecto_id),
         'importado', a.lote_import is not null,
         'registrado_por', (select u.nombre from sgc.usuarios u where u.id = a.registrado_por),
         'created_at', a.created_at,
         'fotos', (select count(*) from sgc.personal_obra_fotos f where f.personal_id = a.id),
         'firmas', (select count(*) from sgc.personal_obra_firmas s where s.personal_id = a.id)
       ) order by a.created_at)
    ) g
    from activos a join dups d on d.dn = a.dn
    group by a.dn
  ) x;
$function$;
grant execute on function sgc.personal_obra_duplicados() to authenticated;

-- ── (5) CE16 — ¿ya existe un trabajador con este documento? (aviso al registrar) ──
create or replace function sgc.personal_obra_doc_existe(p_tipo text, p_numero text, p_exclude uuid default null)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', po.id, 'nombre', po.nombre, 'proyecto_id', po.proyecto_id,
           'proyecto', (select p.nombre from sgc.proyectos p where p.id = po.proyecto_id))), '[]'::jsonb)
  from sgc.personal_obra po
  where po.eliminado_at is null and not coalesce(po.es_prueba,false)
    and (p_exclude is null or po.id <> p_exclude)
    and sgc.doc_normalizado(po.tipo_documento, po.documento_numero)
        = sgc.doc_normalizado(p_tipo, p_numero)
    and sgc.doc_normalizado(p_tipo, p_numero) is not null;
$function$;
grant execute on function sgc.personal_obra_doc_existe(text, text, uuid) to authenticated;

-- ── (6) CE16 — fusionar dos registros (conserva fotos y firmas; descarta en lógico)
create or replace function sgc.fusionar_personal_obra(p_keep uuid, p_drop uuid, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if not (sgc.is_admin()
          or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                     where ur.usuario_id = v_uid and r.codigo in ('legal','abogado'))) then
    raise exception 'Solo admin o Legal pueden fusionar registros de personal' using errcode = '42501';
  end if;
  if p_keep = p_drop then raise exception 'No se puede fusionar un registro consigo mismo'; end if;
  if not exists (select 1 from sgc.personal_obra where id = p_keep and eliminado_at is null) then
    raise exception 'El registro a conservar no existe o ya fue eliminado'; end if;
  if not exists (select 1 from sgc.personal_obra where id = p_drop and eliminado_at is null) then
    raise exception 'El registro a descartar no existe o ya fue eliminado'; end if;

  -- Fotos: mover las que el que se conserva NO tenga (unique personal_id,tipo).
  update sgc.personal_obra_fotos f set personal_id = p_keep
   where f.personal_id = p_drop
     and not exists (select 1 from sgc.personal_obra_fotos k where k.personal_id = p_keep and k.tipo = f.tipo);
  delete from sgc.personal_obra_fotos where personal_id = p_drop;
  -- Firmas: todas al que se conserva.
  update sgc.personal_obra_firmas set personal_id = p_keep where personal_id = p_drop;

  -- Descartar en lógico con rastro.
  update sgc.personal_obra
     set eliminado_at = now(), eliminado_por = v_uid,
         eliminado_motivo = coalesce(nullif(trim(p_motivo),''), 'Fusionado con ' || p_keep::text)
   where id = p_drop;
end;
$function$;
grant execute on function sgc.fusionar_personal_obra(uuid, uuid, text) to authenticated;
