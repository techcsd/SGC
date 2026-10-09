-- 2026-10-08-ck12d-apoyo-retiro-danado.sql
-- CK12/bg4 (FASE 5D.3) — cuando un apoyo es "retiro de material" + material dañado, el
-- sistema genera un BORRADOR de retiro bg4 (sgc.crear_retiro_material) enlazado, para que
-- logística lo complete. El retiro nace en 'pendiente' (no toca cuarentena; eso pasa luego
-- en retiro_recibir). Se crea al llegar la 1.ª foto (crear_retiro_material exige ≥1 foto),
-- reusando esa misma foto. Idempotente (solo si retiro_material_id es null).
-- Regla 19: apoyo_transporte_crear/_agregar_foto verificadas por objeto en prod (== ck12b)
-- antes de reemplazar; aquí se re-crean con el mismo cuerpo + lo nuevo.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck12d-apoyo-retiro-danado.sql --env dev

begin;

-- Persistir la marca "material dañado" (hoy el RPC la recibía y la perdía).
alter table sgc.solicitudes_movimiento add column if not exists es_danado boolean not null default false;

-- ── crear: ahora guarda es_danado ──────────────────────────────────────────────────
create or replace function sgc.apoyo_transporte_crear(
  p_tipo_apoyo text,
  p_proyecto_id uuid,
  p_dia date,
  p_descripcion text,
  p_destino_tipo text default null,
  p_destino_texto text default null,
  p_destino_bodega_id uuid default null,
  p_destino_proyecto_id uuid default null,
  p_es_danado boolean default false,
  p_client_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_tipo text := lower(coalesce(nullif(trim(p_tipo_apoyo),''),'movimiento_interno'));
  v_desc text := nullif(trim(p_descripcion),'');
  v_dest_tipo text;
  v_dest_texto text;
  v_proy text; v_sol text;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  if v_tipo not in ('movimiento_interno','retiro_material','bote') then
    raise exception 'Tipo de apoyo inválido.' using errcode='22023';
  end if;
  if v_desc is null or length(v_desc) < 3 then
    raise exception 'Describe qué hay que mover (mínimo 3 caracteres).' using errcode='22023';
  end if;

  -- Idempotencia.
  if p_client_id is not null then
    select id into v_id from sgc.solicitudes_movimiento where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- Destino por tipo: bote → vertedero fijo; retiro → almacén; interno → lo que venga.
  if v_tipo = 'bote' then
    v_dest_tipo := 'otro'; v_dest_texto := 'Bote (vertedero)';
  elsif v_tipo = 'retiro_material' then
    v_dest_tipo := coalesce(nullif(p_destino_tipo,''),'almacen'); v_dest_texto := nullif(trim(p_destino_texto),'');
  else
    v_dest_tipo := coalesce(nullif(p_destino_tipo,''),'obra'); v_dest_texto := nullif(trim(p_destino_texto),'');
  end if;

  insert into sgc.solicitudes_movimiento (
    solicitante_id, proyecto_id, tipo_apoyo, dia, descripcion, que_se_mueve,
    origen_tipo, origen_proyecto_id,
    destino_tipo, destino_texto, destino_bodega_id, destino_proyecto_id,
    estado, created_by, client_id, es_danado
  ) values (
    v_uid, p_proyecto_id, v_tipo, coalesce(p_dia, current_date), v_desc, v_desc,
    'obra', p_proyecto_id,
    v_dest_tipo, v_dest_texto, p_destino_bodega_id, p_destino_proyecto_id,
    'pendiente', v_uid, p_client_id,
    (v_tipo = 'retiro_material' and coalesce(p_es_danado, false))
  ) returning id into v_id;

  insert into sgc.apoyo_transporte_eventos (solicitud_id, de, a, por, nota)
  values (v_id, null, 'pendiente', v_uid, 'Creó el apoyo de transporte');

  -- Aviso a los referentes de transporte (Misael, Raykler, etc.).
  select nombre into v_proy from sgc.proyectos where id = p_proyecto_id;
  select nombre into v_sol  from sgc.usuarios  where id = v_uid;
  perform sgc._notificar_referentes_movimiento(
    'Nuevo apoyo de transporte',
    coalesce(v_sol,'Un ingeniero')||' pidió '||
      case v_tipo when 'retiro_material' then 'un retiro de material'
                  when 'bote' then 'un bote' else 'un movimiento' end||
      ': '||left(v_desc,80)||coalesce(' · '||v_proy,''),
    '/transporte/apoyo');

  return v_id;
end;
$function$;
grant execute on function sgc.apoyo_transporte_crear(text,uuid,date,text,text,text,uuid,uuid,boolean,uuid) to authenticated, service_role;

-- ── agregar_foto: la 1.ª foto de un retiro dañado genera el borrador bg4 ─────────────
create or replace function sgc.apoyo_transporte_agregar_foto(
  p_solicitud_id uuid, p_path text, p_client_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_s sgc.solicitudes_movimiento%rowtype;
  v_retiro_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode='42501'; end if;
  if not sgc.puede_ver_apoyo(p_solicitud_id) then
    raise exception 'No autorizado.' using errcode='42501';
  end if;
  if p_client_id is not null then
    select id into v_id from sgc.apoyo_transporte_fotos where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into sgc.apoyo_transporte_fotos (solicitud_id, path, tomada_por, client_id)
  values (p_solicitud_id, p_path, v_uid, p_client_id)
  returning id into v_id;

  -- bg4 (CK12.4): si es un retiro de material dañado y aún no tiene borrador de retiro,
  -- créalo reusando esta foto (crear_retiro_material exige ≥1 foto y ≥1 renglón). Nace en
  -- 'pendiente' → logística lo completa; NO toca cuarentena. Mejor esfuerzo: si falla no
  -- bloquea la foto ni el apoyo.
  select * into v_s from sgc.solicitudes_movimiento where id = p_solicitud_id;
  if v_s.tipo_apoyo = 'retiro_material' and coalesce(v_s.es_danado, false)
     and v_s.retiro_material_id is null and v_s.proyecto_id is not null then
    begin
      v_retiro_id := sgc.crear_retiro_material(
        v_s.proyecto_id,
        v_s.destino_bodega_id,
        'otro',
        null,
        coalesce(v_s.descripcion, v_s.que_se_mueve),
        jsonb_build_array(jsonb_build_object(
          'descripcion', coalesce(v_s.descripcion, v_s.que_se_mueve, 'Material dañado'), 'cantidad', 1)),
        jsonb_build_array(jsonb_build_object('path', p_path)),
        coalesce(v_s.es_prueba, false));
      update sgc.solicitudes_movimiento set retiro_material_id = v_retiro_id where id = p_solicitud_id;
      insert into sgc.apoyo_transporte_eventos (solicitud_id, de, a, por, nota)
      values (p_solicitud_id, v_s.estado, v_s.estado, v_uid,
              'Se generó un borrador de retiro de material dañado para que logística lo complete.');
    exception when others then
      null; -- el borrador es una conveniencia; no debe tumbar la foto/apoyo.
    end;
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.apoyo_transporte_agregar_foto(uuid,text,uuid) to authenticated, service_role;

commit;
