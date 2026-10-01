-- CE10 — Avisos por obra van solo a los miembros de esa obra (no a todos los ingenieros)
-- ---------------------------------------------------------------------------------
-- Causa real (verificada en prod, NO la regresión de CA2 que se sospechaba):
--   el rol `ingeniero_campo` (15 usuarios) tiene los módulos `inventario` Y `bitacora`,
--   así que todo `notificar_modulo('inventario'|'bitacora', …)` de un aviso POR OBRA
--   llegaba a los 15 ingenieros (+ 5 gerente_proyectos) sin importar su obra.
--   puede_ver_proyecto NO lo usa ningún emisor de notificaciones (descartado por SELECT).
-- Arreglo: es_miembro_obra() + notificar_obra() = miembros de ESA obra + roles de gestión
--   explícitos; los emisores por obra dejan de usar notificar_modulo. Ver (2) abajo.
-- Copias VIVAS de prod con el único cambio del destinatario (regla 19).
-- ---------------------------------------------------------------------------------

-- ── (1) es_miembro_obra: responsable / residente / ingeniero asignado / empleado ──
-- Mismo predicado SCOPED que es_mia_proyecto (SIN la visibilidad amplia por módulo
-- que puede_ver_proyecto añade). "Ver" una obra ≠ "estar" en la obra.
create or replace function sgc.es_miembro_obra(p_proyecto uuid, p_usuario uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select sgc.es_mia_proyecto(p_proyecto, p_usuario);
$function$;
grant execute on function sgc.es_miembro_obra(uuid, uuid) to authenticated;

-- ── (2) notificar_obra: miembros de la obra + roles de gestión de la Matriz ───────
-- Reemplaza a notificar_modulo para todo aviso ligado a una obra. Respeta el silencio
-- (notif_permitida), traduce el título (BS4) y empuja push al mismo público.
create or replace function sgc.notificar_obra(
  p_proyecto uuid,
  p_tipo text,
  p_titulo text,
  p_mensaje text,
  p_ruta text default null,
  p_referencia_id uuid default null,
  p_referencia_tipo text default null,
  p_roles_gestion text[] default array['admin','logistica','coord_compras','guarda_almacen','gerencia','direccion']
) returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_ids uuid[];
begin
  select array_agg(u.id) into v_ids
  from sgc.usuarios u
  where u.activo
    and sgc.notif_permitida(u.id, coalesce(p_tipo,'info'))
    and (
      sgc.es_miembro_obra(p_proyecto, u.id)
      or exists (
        select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = u.id and r.codigo = any(p_roles_gestion)
      )
    );
  if v_ids is null then return; end if;

  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_id, referencia_tipo)
  select u.id, coalesce(p_tipo,'info'),
         coalesce(nt.titulo_i18n ->> u.idioma, p_titulo),
         p_mensaje, p_ruta, p_referencia_id, p_referencia_tipo
  from sgc.usuarios u
  left join sgc.notif_tipo nt on nt.tipo = coalesce(p_tipo,'info')
  where u.id = any(v_ids);

  perform sgc.send_push(
    v_ids, p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta,
      'referencia_id', p_referencia_id, 'referencia_tipo', p_referencia_tipo));
end
$function$;
grant execute on function sgc.notificar_obra(uuid,text,text,text,text,uuid,text,text[]) to authenticated;

-- ── (3) Emisores por obra: notificar_modulo → notificar_obra (copias vivas) ───────

-- ·· requisiciones_vencidas_avisar ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.requisiciones_vencidas_avisar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_rec record;
  v_n int := 0;
  v_codigo text;
begin
  for v_rec in
    select id, folio, solicitante_id, proyecto_id, fecha_necesidad
      from sgc.solicitudes_material
     where fecha_necesidad is not null
       and fecha_necesidad < current_date
       and coalesce(estado,'pendiente') in ('pendiente','aprobada','por_despachar','parcial')
       and aviso_vencida_at is null
       and not coalesce(es_prueba, false)
  loop
    v_codigo := coalesce('REQ-' || lpad(v_rec.folio::text, 6, '0'), 'Una requisición');
    -- Al solicitante.
    if v_rec.solicitante_id is not null then
      perform sgc.notificar_usuarios(array[v_rec.solicitante_id], 'requisicion_vencida',
        'Requisición vencida',
        format('%s pasó su fecha de necesidad (%s) y sigue abierta.', v_codigo, to_char(v_rec.fecha_necesidad,'DD/MM/YYYY')),
        '/inventario/requisiciones', v_rec.id, 'requisicion');
    end if;
    -- A logística/inventario.
    perform sgc.notificar_obra(v_rec.proyecto_id, 'requisicion_vencida',
      'Requisición vencida',
      format('%s pasó su fecha de necesidad (%s) y sigue abierta.', v_codigo, to_char(v_rec.fecha_necesidad,'DD/MM/YYYY')),
      '/inventario/requisiciones', v_rec.id, 'requisicion');

    update sgc.solicitudes_material set aviso_vencida_at = now() where id = v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

-- ·· requisicion_set_fecha_necesidad ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.requisicion_set_fecha_necesidad(p_id uuid, p_fecha date, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_sol  sgc.solicitudes_material;
  v_fase text;
  v_old  date;
begin
  select * into v_sol from sgc.solicitudes_material where id = p_id;
  if not found then raise exception 'Requisición no encontrada' using errcode = '22023'; end if;

  v_fase := sgc.requisicion_fase(p_id);
  if not (
    (v_sol.solicitante_id = v_uid and v_fase in ('pendiente', 'en_proceso'))
    or sgc.es_flota_elevado()
    or sgc.tiene_modulo('inventario')
  ) then
    raise exception 'No puedes editar la fecha de necesidad de esta requisición' using errcode = '22023';
  end if;

  v_old := v_sol.fecha_necesidad::date;
  update sgc.solicitudes_material set fecha_necesidad = p_fecha where id = p_id;

  insert into sgc.solicitud_material_ediciones (solicitud_id, editado_por, editado_at, cambios)
  values (p_id, v_uid, now(),
          jsonb_build_object('campo', 'fecha_necesidad', 'antes', v_old, 'despues', p_fecha, 'motivo', coalesce(p_motivo, '')));

  -- Aviso al aprobador solo si adelanta (o si antes no tenía fecha).
  if v_old is null or p_fecha < v_old then
    begin
      perform sgc.notificar_obra(v_sol.proyecto_id, 'requisicion_fecha_cambio',
        'Fecha de necesidad adelantada',
        'Una requisición ahora se necesita el ' || to_char(p_fecha, 'DD/MM/YYYY') || '.',
        '/inventario/requisiciones', p_id, 'requisicion');
    exception when others then null; -- el aviso nunca bloquea la edición
    end;
  end if;
end $function$;

-- ·· trg_conduce_por_confirmar ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.trg_conduce_por_confirmar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_enc uuid;
  v_bodega text;
  v_titulo text;
  v_mensaje text;
  v_ruta text;
begin
  -- Sólo la transición que ABRE el badge, y sólo si el destino es una bodega.
  if not (new.estado in ('entregado','entregado_incompleto')
          and new.recibido_por is null
          and old.estado is distinct from new.estado
          and new.destino_almacen_id is not null
          and not coalesce(new.es_prueba, false)) then
    return new;
  end if;

  select b.encargado_id, b.nombre into v_enc, v_bodega
    from sgc.bodegas b where b.id = new.destino_almacen_id;

  v_titulo  := 'Conduce por confirmar';
  v_mensaje := 'Llegó mercancía a ' || coalesce(v_bodega, 'la bodega') || '. Confírmala cuando la recibas.';
  v_ruta    := '/inventario/conduces';

  if v_enc is not null then
    -- Bodega con encargado: avisa SÓLO al responsable directo.
    perform sgc.notificar_usuarios(array[v_enc], 'conduce_por_confirmar', v_titulo, v_mensaje,
                                   v_ruta, new.id, 'salida');
  else
    -- Sin encargado: respaldo al módulo inventario (que no quede sin dueño).
    perform sgc.notificar_obra(new.proyecto_id, 'conduce_por_confirmar', v_titulo, v_mensaje,
                                 v_ruta, new.id, 'salida');
  end if;

  return new;
end $function$;

-- ·· agregar_items_libres_conduce ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.agregar_items_libres_conduce(p_salida_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  it jsonb; v_n int := 0; v_nombre text; v_cant numeric; v_unidad text;
  v_num text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or v_s.creado_por = v_uid
          or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = v_uid)) then
    raise exception 'No autorizado para agregar materiales a este conduce.';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_nombre := nullif(trim(coalesce(it->>'nombre','')),'');
    if v_nombre is null then continue; end if;
    v_cant   := coalesce(nullif(it->>'cantidad','')::numeric, 1);
    if v_cant <= 0 then v_cant := 1; end if;
    v_unidad := nullif(trim(coalesce(it->>'unidad','')),'');

    insert into sgc.salida_items_libres (salida_id, nombre, cantidad, unidad, es_prueba, created_by)
    values (p_salida_id, v_nombre, v_cant, v_unidad, coalesce(v_s.es_prueba, false), v_uid);
    v_n := v_n + 1;
  end loop;

  -- Alerta al admin/inventario (regla AT11): "Material no catalogado en conduce #X".
  if v_n > 0 and not coalesce(v_s.es_prueba, false) then
    v_num := 'CND-' || upper(left(p_salida_id::text, 8));
    perform sgc.notificar_obra(v_s.proyecto_id, 'material_no_catalogado',
      'Material no catalogado en un conduce',
      'El conduce '||v_num||' incluye '||v_n||' material(es) que no están en el catálogo. Revísalos y crea el artículo.',
      '/inventario/material-no-catalogado');
  end if;

  return v_n;
end;
$function$;

-- ·· crear_retiro_material ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.crear_retiro_material(p_proyecto_id uuid, p_almacen_destino_id uuid, p_motivo_dano text, p_motivo_dano_detalle text, p_notas text, p_items jsonb, p_fotos jsonb, p_es_prueba boolean, p_client_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Idempotencia: si ya existe un retiro con este client_id, devolverlo (no duplica).
  if p_client_id is not null then
    select id into v_id from sgc.retiros_material where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  if p_proyecto_id is null then
    raise exception using errcode='22023', message='Indica la obra del material dañado.',
      detail='{"campo":"proyecto_id","motivo":"requerido"}';
  end if;
  if p_motivo_dano is null or p_motivo_dano not in ('danado_obra','defecto_fabrica','vencido','otro') then
    raise exception using errcode='22023', message='Indica el motivo del daño.',
      detail='{"campo":"motivo_dano","motivo":"requerido"}';
  end if;
  if coalesce(jsonb_array_length(p_items),0) = 0 then
    raise exception using errcode='22023', message='Agrega al menos un artículo a retirar.',
      detail='{"campo":"items","motivo":"requerido"}';
  end if;
  if coalesce(jsonb_array_length(p_fotos),0) = 0 then
    raise exception using errcode='22023', message='Agrega al menos una foto del material dañado.',
      detail='{"campo":"fotos","motivo":"requerido"}';
  end if;

  insert into sgc.retiros_material
    (proyecto_id, solicitante_id, almacen_destino_id, motivo_dano, motivo_dano_detalle, notas, es_prueba, client_id)
  values
    (p_proyecto_id, v_uid, p_almacen_destino_id, p_motivo_dano,
     nullif(trim(p_motivo_dano_detalle),''), nullif(trim(p_notas),''), coalesce(p_es_prueba,false), p_client_id)
  returning id into v_id;

  insert into sgc.retiro_material_items (retiro_id, articulo_id, descripcion, cantidad, unidad)
  select v_id,
         nullif(i->>'articulo_id','')::uuid,
         coalesce(nullif(trim(i->>'descripcion'),''), 'Artículo'),
         (i->>'cantidad')::numeric,
         nullif(trim(i->>'unidad'),'')
  from jsonb_array_elements(p_items) i;

  insert into sgc.retiro_material_fotos (retiro_id, path, nombre)
  select v_id, i->>'path', nullif(i->>'nombre','')
  from jsonb_array_elements(p_fotos) i
  where nullif(i->>'path','') is not null;

  begin
    perform sgc.notificar_obra(p_proyecto_id, 'retiro_material',
      'Nuevo retiro de material dañado',
      'RET-' || lpad((select folio::text from sgc.retiros_material where id=v_id),6,'0')
        || ' — ' || coalesce((select nombre from sgc.proyectos where id=p_proyecto_id),'obra'),
      '/inventario/retiros?item=' || v_id::text);
  exception when others then null; end;

  return v_id;
end;
$function$;

-- ·· guardar_bitacora_extra ·· (2 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.guardar_bitacora_extra(p_bitacora_id uuid, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_proyecto uuid;
  v_prueba   boolean;
  v_danos    jsonb := coalesce(p_extra->'danos', '[]'::jsonb);
  v_moldes   jsonb := coalesce(p_extra->'moldes', '[]'::jsonb);
  v_d        jsonb;
  v_idx      int := 0;
  v_tipo text; v_articulo uuid; v_nombre text; v_cant numeric; v_unidad text;
  v_ucap text; v_factor numeric; v_detalle text; v_solicita boolean;
  v_fotos    text[];
  v_retiro   uuid; v_client uuid;
  v_creados  int := 0; v_retiros int := 0; v_moldes_n int := 0;
  v_m jsonb; v_tramos jsonb; v_plano jsonb; v_desv numeric; v_tol numeric;
  v_obra text; v_avisados int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select proyecto_id, es_prueba into v_proyecto, v_prueba
    from sgc.bitacoras where id = p_bitacora_id;
  if v_proyecto is null then
    raise exception using errcode='22023', message='Bitácora no encontrada.',
      detail='{"campo":"bitacora_id","motivo":"no_existe"}';
  end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('bitacora')
          or exists (select 1 from sgc.bitacoras b where b.id = p_bitacora_id and b.usuario_id = v_uid)) then
    raise exception 'No autorizado para editar esta bitácora';
  end if;

  -- ── DAÑOS (BP4) ────────────────────────────────────────────────────────────
  delete from sgc.bitacora_danos where bitacora_id = p_bitacora_id;
  for v_d in select * from jsonb_array_elements(v_danos) loop
    v_tipo := v_d->>'tipo';
    if v_tipo not in ('material','equipo_propio') then continue; end if;
    v_articulo := nullif(v_d->>'articulo_id','')::uuid;
    v_nombre   := nullif(trim(v_d->>'nombre_libre'),'');
    v_cant     := nullif(v_d->>'cantidad','')::numeric;
    v_unidad   := nullif(trim(v_d->>'unidad'),'');
    v_ucap     := nullif(trim(v_d->>'unidad_capturada'),'');
    v_factor   := nullif(v_d->>'factor_aplicado','')::numeric;
    v_detalle  := nullif(trim(v_d->>'detalle'),'');
    v_solicita := coalesce((v_d->>'solicita_retiro')::boolean, false);
    select coalesce(array_agg(x), '{}') into v_fotos
      from jsonb_array_elements_text(coalesce(v_d->'fotos_paths','[]'::jsonb)) x;

    if v_detalle is null then
      raise exception using errcode='22023', message='Describe el daño.',
        detail='{"campo":"detalle","motivo":"requerido"}';
    end if;
    if v_tipo = 'material' and (v_articulo is null and v_nombre is null) then
      raise exception using errcode='22023', message='Indica qué material se dañó.',
        detail='{"campo":"material","motivo":"requerido"}';
    end if;
    if v_tipo = 'equipo_propio' and v_nombre is null then
      raise exception using errcode='22023', message='Indica qué equipo propio se dañó.',
        detail='{"campo":"equipo","motivo":"requerido"}';
    end if;
    if v_tipo = 'equipo_propio' then v_solicita := false; end if;

    v_retiro := null; v_client := null;
    if v_tipo = 'material' and v_solicita then
      if array_length(v_fotos,1) is null then
        raise exception using errcode='22023',
          message='Para solicitar el retiro del material dañado, agrega al menos una foto.',
          detail='{"campo":"fotos","motivo":"requerido_para_retiro"}';
      end if;
      v_client := md5(p_bitacora_id::text || ':' || v_idx)::uuid;
      v_retiro := sgc.crear_retiro_material(
        v_proyecto, null, 'danado_obra', null,
        'Reportado desde la bitácora del ' || to_char((current_date), 'YYYY-MM-DD'),
        jsonb_build_array(jsonb_build_object(
          'articulo_id', v_articulo,
          'descripcion', coalesce(v_nombre, (select nombre from sgc.articulos where id = v_articulo), 'Material'),
          'cantidad', coalesce(v_cant, 1),
          'unidad', v_unidad)),
        (select jsonb_agg(jsonb_build_object('path', p)) from unnest(v_fotos) p),
        coalesce(v_prueba,false), v_client);
      v_retiros := v_retiros + 1;
    end if;

    insert into sgc.bitacora_danos
      (bitacora_id, tipo, articulo_id, nombre_libre, cantidad, unidad, unidad_capturada,
       factor_aplicado, detalle, fotos_paths, solicita_retiro, retiro_id)
    values
      (p_bitacora_id, v_tipo, v_articulo, v_nombre, v_cant, v_unidad, v_ucap,
       v_factor, v_detalle, v_fotos, v_solicita, v_retiro);
    v_creados := v_creados + 1;

    if v_tipo = 'equipo_propio' then
      begin
        perform sgc.notificar_obra(v_proyecto, 'equipo_danado',
          'Equipo propio dañado en obra',
          coalesce(v_nombre,'Equipo') || ' — ' ||
            coalesce((select nombre from sgc.proyectos where id = v_proyecto), 'obra'),
          '/bitacora/historial?item=' || p_bitacora_id::text);
      exception when others then null; end;
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- ── MOLDES (BO9) ───────────────────────────────────────────────────────────
  select coalesce(nullif(valor,'')::numeric, 2) into v_tol from sgc.parametros where clave = 'molde_tolerancia_cm';
  v_tol := coalesce(v_tol, 2);
  select nombre into v_obra from sgc.proyectos where id = v_proyecto;

  delete from sgc.bitacora_molde_medidas where bitacora_id = p_bitacora_id;
  v_idx := 0;
  for v_m in select * from jsonb_array_elements(v_moldes) loop
    v_tramos := coalesce(v_m->'tramos', '[]'::jsonb);
    v_plano  := v_m->'medida_plano';
    if jsonb_typeof(v_plano) is distinct from 'array' then v_plano := null; end if;

    -- Desviación máxima real↔plano por dimensión (tramos emparejados por posición).
    v_desv := null;
    if v_plano is not null then
      select max(greatest(
        abs(coalesce((t.val->>'largo_cm')::numeric,0)   - coalesce((p.val->>'largo_cm')::numeric,0)),
        abs(coalesce((t.val->>'alto_cm')::numeric,0)    - coalesce((p.val->>'alto_cm')::numeric,0)),
        abs(coalesce((t.val->>'espesor_cm')::numeric,0) - coalesce((p.val->>'espesor_cm')::numeric,0))
      ))
      into v_desv
      from jsonb_array_elements(v_tramos) with ordinality t(val, i)
      left join jsonb_array_elements(v_plano) with ordinality p(val, j) on t.i = p.j;
    end if;

    select coalesce(array_agg(x), '{}') into v_fotos
      from jsonb_array_elements_text(coalesce(v_m->'fotos_paths','[]'::jsonb)) x;

    insert into sgc.bitacora_molde_medidas
      (bitacora_id, estructura, identificador, orden, forma, tramos, medida_plano,
       desviacion_max_cm, notas, fotos_paths)
    values
      (p_bitacora_id, nullif(trim(v_m->>'estructura'),''), nullif(trim(v_m->>'identificador'),''),
       v_idx, coalesce(nullif(v_m->>'forma',''),'rectangular'), v_tramos, v_plano,
       v_desv, nullif(trim(v_m->>'notas'),''), v_fotos);
    v_moldes_n := v_moldes_n + 1;

    if v_desv is not null and v_desv > v_tol then
      begin
        perform sgc.notificar_obra(v_proyecto, 'molde_desviacion',
          'Molde fuera de tolerancia',
          coalesce(nullif(trim(v_m->>'identificador'),''),'Molde') || ': desvío ' || v_desv ||
            ' cm (> ' || v_tol || ') — ' || coalesce(v_obra,'obra'),
          '/bitacora/historial?item=' || p_bitacora_id::text);
        v_avisados := v_avisados + 1;
      exception when others then null; end;
    end if;
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('danos', v_creados, 'retiros', v_retiros,
                            'moldes', v_moldes_n, 'moldes_fuera_tolerancia', v_avisados);
end;
$function$;

-- ·· crear_cartilla ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.crear_cartilla(p_id uuid, p_proyecto_id uuid, p_fecha date, p_atados jsonb, p_fotos jsonb DEFAULT '[]'::jsonb, p_plano_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_atado jsonb; v_pieza jsonb; v_foto jsonb;
  v_atado_id uuid; v_kg numeric; v_kg_m numeric; v_long numeric; v_cant int;
  v_diam text; v_fig text; v_tramo jsonb; v_orden_a int := 0; v_orden_p int; v_orden_f int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('bitacora') or sgc.es_responsable_de_proyecto(p_proyecto_id, v_uid)) then
    raise exception 'No autorizado para crear cartillas en esta obra' using errcode = '42501';
  end if;

  -- Idempotencia por client-UUID.
  if exists (select 1 from sgc.cartillas where id = p_id) then
    return p_id;
  end if;

  insert into sgc.cartillas (id, proyecto_id, ingeniero_id, fecha, plano_path, notas, estado)
  values (p_id, p_proyecto_id, v_uid, coalesce(p_fecha, current_date), nullif(p_plano_path,''), nullif(p_notas,''), 'enviada');

  for v_atado in select * from jsonb_array_elements(coalesce(p_atados, '[]'::jsonb)) loop
    v_orden_a := v_orden_a + 1;
    insert into sgc.cartilla_atados (cartilla_id, identificador, elemento, cantidad_piezas, orden)
    values (p_id, nullif(v_atado->>'identificador',''), nullif(v_atado->>'elemento',''),
            nullif(v_atado->>'cantidad_piezas','')::int, v_orden_a)
    returning id into v_atado_id;

    v_orden_p := 0;
    for v_pieza in select * from jsonb_array_elements(coalesce(v_atado->'piezas', '[]'::jsonb)) loop
      v_orden_p := v_orden_p + 1;
      v_diam := nullif(v_pieza->>'diametro_codigo','');
      v_fig := nullif(v_pieza->>'figura_codigo','');
      v_cant := coalesce(nullif(v_pieza->>'cantidad','')::int, 1);

      if v_diam is null or not exists (select 1 from sgc.acero_diametros where codigo = v_diam and activo) then
        raise exception 'Diámetro inválido: %', coalesce(v_diam,'(vacío)') using errcode = '22023', detail = 'campo=diametro_codigo';
      end if;
      if v_fig is null or not exists (select 1 from sgc.cartilla_figuras where codigo = v_fig and activo) then
        raise exception 'Figura inválida: %', coalesce(v_fig,'(vacío)') using errcode = '22023', detail = 'campo=figura_codigo';
      end if;

      -- longitud total: suma de tramos si vienen, si no la longitud dada.
      v_long := nullif(v_pieza->>'longitud_total_cm','')::numeric;
      if v_pieza ? 'tramos_cm' and jsonb_typeof(v_pieza->'tramos_cm') = 'array' then
        select coalesce(sum((t->>'cm')::numeric), 0) into v_long
          from jsonb_array_elements(v_pieza->'tramos_cm') t;
      end if;
      v_long := coalesce(v_long, 0);
      select kg_por_m into v_kg_m from sgc.acero_diametros where codigo = v_diam;
      v_kg := round((v_long / 100.0) * coalesce(v_kg_m, 0) * v_cant, 3);

      insert into sgc.cartilla_piezas (atado_id, marca, diametro_codigo, figura_codigo, tramos_cm, longitud_total_cm, cantidad, peso_kg, orden)
      values (v_atado_id, nullif(v_pieza->>'marca',''), v_diam, v_fig,
              case when v_pieza ? 'tramos_cm' then v_pieza->'tramos_cm' else null end,
              v_long, v_cant, v_kg, v_orden_p);
    end loop;
  end loop;

  for v_foto in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    v_orden_f := v_orden_f + 1;
    insert into sgc.cartilla_fotos (cartilla_id, path, orden)
    values (p_id, coalesce(v_foto->>'path', v_foto#>>'{}'), v_orden_f);
  end loop;

  insert into sgc.cartilla_eventos (cartilla_id, estado_desde, estado_hasta, usuario_id, nota)
  values (p_id, null, 'enviada', v_uid, 'Cartilla enviada');

  perform sgc.notificar_obra(p_proyecto_id, 'cartilla_nueva',
    'Nueva cartilla de acero',
    format('Se envió una cartilla para revisión (obra %s).',
      coalesce((select nombre from sgc.proyectos where id = p_proyecto_id), 'sin nombre')),
    '/bitacora/cartillas/' || p_id::text, p_id, 'cartilla');

  return p_id;
end $function$;

-- ·· crear_orden_trabajo ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.crear_orden_trabajo(p_proyecto_id uuid, p_fecha date, p_descripcion text, p_ubicacion text DEFAULT NULL::text, p_cantidad numeric DEFAULT NULL::numeric, p_unidad text DEFAULT NULL::text, p_monto_estimado numeric DEFAULT NULL::numeric, p_solicitado_por text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_comentarios text DEFAULT NULL::text, p_firma_ing jsonb DEFAULT NULL::jsonb, p_firma_cli jsonb DEFAULT NULL::jsonb, p_es_prueba boolean DEFAULT false, p_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid := coalesce(p_id, gen_random_uuid());  -- BN1b — id explícito idempotente
  v_es_prueba boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;
  if p_proyecto_id is null then raise exception 'Falta la obra'; end if;
  if coalesce(trim(p_descripcion), '') = '' then
    raise exception 'La descripción del trabajo es obligatoria';
  end if;

  if not sgc.is_admin() then
    if p_firma_ing is null or coalesce(trim(p_firma_ing->>'firma_path'), '') = '' then
      raise exception 'Falta la firma del ingeniero';
    end if;
    if p_firma_cli is null or coalesce(trim(p_firma_cli->>'firma_path'), '') = '' then
      raise exception 'Falta la firma del cliente';
    end if;
  end if;

  -- Cabecera con id EXPLÍCITO. BN1b — on conflict do nothing: un reintento del
  -- outbox con el mismo p_id NO duplica; devolvemos el id sin re-insertar hijas.
  insert into sgc.bitacoras (id, usuario_id, proyecto_id, fecha, tipo, comentarios, es_prueba)
  values (v_id, v_uid, p_proyecto_id, coalesce(p_fecha, current_date), 'orden_trabajo',
          nullif(trim(p_comentarios), ''), coalesce(p_es_prueba, false))
  on conflict (id) do nothing
  returning es_prueba into v_es_prueba;

  if not found then
    -- Ya existía (reintento idempotente): la orden completa está en la BD.
    return v_id;
  end if;

  insert into sgc.bitacora_orden_detalle (
    bitacora_id, descripcion, ubicacion, cantidad, unidad,
    monto_estimado, solicitado_por, notas, es_prueba
  ) values (
    v_id, trim(p_descripcion), nullif(trim(p_ubicacion), ''), p_cantidad,
    nullif(trim(p_unidad), ''), p_monto_estimado, nullif(trim(p_solicitado_por), ''),
    nullif(trim(p_notas), ''), v_es_prueba
  );

  if p_firma_ing is not null and coalesce(trim(p_firma_ing->>'firma_path'), '') <> '' then
    insert into sgc.bitacora_orden_firmas (bitacora_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
    values (v_id, 'ingeniero',
            coalesce(nullif(trim(p_firma_ing->>'nombre'), ''), 'Ingeniero'),
            nullif(trim(p_firma_ing->>'cedula'), ''),
            nullif(trim(p_firma_ing->>'rol_desc'), ''),
            v_uid,
            trim(p_firma_ing->>'firma_path'),
            coalesce(nullif(p_firma_ing->>'metodo', ''), 'pad'));
  end if;
  if p_firma_cli is not null and coalesce(trim(p_firma_cli->>'firma_path'), '') <> '' then
    insert into sgc.bitacora_orden_firmas (bitacora_id, rol, nombre, cedula, rol_desc, firma_path, metodo)
    values (v_id, 'cliente',
            coalesce(nullif(trim(p_firma_cli->>'nombre'), ''), 'Cliente'),
            nullif(trim(p_firma_cli->>'cedula'), ''),
            nullif(trim(p_firma_cli->>'rol_desc'), ''),
            trim(p_firma_cli->>'firma_path'),
            coalesce(nullif(p_firma_cli->>'metodo', ''), 'pad'));
  end if;

  -- BW1 — aviso al crear (regla 7). Solo en creación real (no en reintento idempotente,
  -- que retornó arriba) y no para órdenes de prueba. Deep-link a la ficha. No tumba el alta.
  if not coalesce(v_es_prueba, false) then
    begin
      perform sgc.notificar_obra(p_proyecto_id, 'orden_trabajo_creada',
        'Nueva orden de trabajo',
        coalesce((select p.nombre from sgc.proyectos p where p.id = p_proyecto_id), 'Obra')
          || ' · ' || left(trim(p_descripcion), 80),
        '/bitacora/orden-trabajo/' || v_id::text,
        v_id, 'bitacora_orden');
    exception when others then null;
    end;
  end if;

  return v_id;
end;
$function$;

-- ·· trg_molde_aviso_desviacion ·· (1 aviso/s por obra → notificar_obra)
CREATE OR REPLACE FUNCTION sgc.trg_molde_aviso_desviacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_tol numeric := coalesce((select valor::numeric from sgc.parametros where clave='molde_tolerancia_cm'), 2);
begin
  if coalesce(new.desviacion_max_cm, 0) > v_tol and not coalesce(new.es_prueba, false) then
    perform sgc.notificar_obra((select b.proyecto_id from sgc.bitacoras b where b.id = new.bitacora_id), 'molde_desviacion',
      'Molde fuera de tolerancia',
      format('%s %s: desvío de %s cm (tolerancia %s cm).',
        coalesce(new.estructura, 'Molde'), coalesce(new.identificador, ''),
        round(new.desviacion_max_cm, 1), v_tol),
      '/bitacora/moldes', new.id, 'molde');
  end if;
  return new;
end;
$function$;
