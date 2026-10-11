-- 2026-10-09-cm4-conduce-fase-receptor.sql — CM4 (reglas 18/19) — PARCHE 🔴
--
-- Raykler no puede transferir un conduce con receptor designado (#197). Causa: `conduce_fase`
-- pone 'pendiente_firma' en cuanto hay `firma_pendiente_usuario_id` (receptor designado por
-- AT16/CK4), ANTES de que el material salga — y `ofrecer_transferencia_conduce` solo deja
-- transferir en emitido/en_transito. La web muestra el botón igual → el servidor rechaza al final.
--
-- Fix (regla 19: defs vivas en prod leídas y == dev):
--   1) conduce_fase: 'pendiente_firma' SOLO si ya llegó (entregado/entregando) Y hay firma
--      pendiente. Antes de llegar, el receptor designado NO cambia la fase (emitido/en_transito).
--   2) conduce_puede_transferir(p_salida_id) jsonb {puede,motivo}: fuente única web/app/RPC.
--   3) ofrecer_transferencia_conduce usa esa función (conserva el receptor designado).
--   4) firmar_conduce (receptor): rechaza si el conduce aún no llegó.
--
--   node scripts/apply-migration.mjs sql/2026-10-09-cm4-conduce-fase-receptor.sql --env dev

begin;

-- ── 1) Fase correcta ─────────────────────────────────────────────────────────────
-- NOTA: `firma_pendiente_usuario_id` también es el RECEPTOR designado ANTES de entregar
-- (AT16/CK4). No debe cambiar la fase hasta que el material llegue (CJ6 limpia la columna
-- al recibir). Por eso 'pendiente_firma' exige además estado entregado/entregando.
create or replace function sgc.conduce_fase(p_salida_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select case
    when s.id is null then null
    when s.recibido_por is not null
      or exists (select 1 from sgc.recepcion_confirmaciones rc
                 where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id=s.id) then 'confirmado'
    -- CM4: firma pendiente SOLO una vez que el material llegó (no por tener receptor designado).
    when (s.estado in ('entregado','entregado_incompleto') or s.entregando_at is not null)
      and s.firma_pendiente_usuario_id is not null then 'pendiente_firma'
    when s.estado in ('entregado','entregado_incompleto') then 'entregado'
    when s.entregando_at is not null then 'entregando'
    when s.transito_at is not null
      or (p.estado = 'en_camino')
      or exists (select 1 from sgc.rutas r where r.id=s.ruta_id and r.estado='en_curso') then 'en_transito'
    else 'emitido'
  end
  from sgc.salidas_inventario s
  left join sgc.ruta_paradas p on p.id = s.ruta_parada_id
  where s.id = p_salida_id;
$function$;

-- ── 2) ¿Se puede transferir? (fuente única web/app/RPC) ──────────────────────────
create or replace function sgc.conduce_puede_transferir(p_salida_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_salida sgc.salidas_inventario%rowtype;
  v_es_flota boolean;
  v_soy_responsable boolean;
  v_fase text;
  v_receptor text;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id;
  if not found then return jsonb_build_object('puede', false, 'motivo', 'Conduce no encontrado.'); end if;

  v_es_flota := sgc.is_admin() or sgc.es_flota_elevado() or sgc.tiene_modulo('inventario');
  v_soy_responsable := exists (select 1 from sgc.conductores c
                               where c.id = v_salida.conductor_id and c.usuario_id = v_uid);
  if not (v_soy_responsable or v_es_flota) then
    return jsonb_build_object('puede', false,
      'motivo', 'Solo el chofer responsable, Flota o Inventario puede transferir este conduce.');
  end if;

  v_fase := sgc.conduce_fase(p_salida_id);
  if v_fase not in ('emitido', 'en_transito') then
    v_receptor := coalesce(nullif(trim(v_salida.firma_pendiente_nombre), ''), 'el receptor');
    if v_fase in ('entregando', 'entregado', 'pendiente_firma', 'confirmado') then
      return jsonb_build_object('puede', false,
        'motivo', format('Este conduce ya llegó a la obra; ya no se transfiere. Lo que falta es que %s confirme la recepción.', v_receptor));
    end if;
    return jsonb_build_object('puede', false, 'motivo', format('Este conduce no se puede transferir (fase "%s").', v_fase));
  end if;

  if exists (select 1 from sgc.conduce_transferencias where salida_id = p_salida_id and estado = 'ofrecida') then
    return jsonb_build_object('puede', false, 'motivo', 'Ya hay una transferencia pendiente para este conduce.');
  end if;

  return jsonb_build_object('puede', true, 'motivo', null);
end;
$function$;
grant execute on function sgc.conduce_puede_transferir(uuid) to authenticated, service_role;

-- ── 3) Transferir usa la regla única (y conserva el receptor designado) ──────────
create or replace function sgc.ofrecer_transferencia_conduce(p_salida_id uuid, p_a_conductor_id uuid, p_notas text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_salida sgc.salidas_inventario%rowtype;
  v_chk jsonb;
  v_a_usuario uuid; v_de_nombre text; v_id uuid; v_es_prueba boolean; v_fase text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado'; end if;

  -- CM4: misma regla que la web/app (conduce_puede_transferir). Mensaje claro si no se puede.
  v_chk := sgc.conduce_puede_transferir(p_salida_id);
  if not coalesce((v_chk->>'puede')::boolean, false) then
    raise exception '%', coalesce(v_chk->>'motivo', 'Este conduce no se puede transferir.') using errcode = 'DR423';
  end if;

  if p_a_conductor_id = v_salida.conductor_id then
    raise exception 'El conduce ya está a cargo de ese chofer';
  end if;
  if not exists (select 1 from sgc.conductores where id = p_a_conductor_id and coalesce(activo,true)) then
    raise exception 'Chofer destino no válido';
  end if;

  v_fase := sgc.conduce_fase(p_salida_id);
  v_es_prueba := coalesce(v_salida.es_prueba, false);
  -- El receptor designado (firma_pendiente_usuario_id) NO se toca: la firma la hace la obra.
  insert into sgc.conduce_transferencias (
    salida_id, de_conductor_id, a_conductor_id, ofrecida_por, notas,
    fase_al_transferir, es_prueba, es_prueba_origen)
  values (p_salida_id, v_salida.conductor_id, p_a_conductor_id, v_uid, nullif(trim(p_notas),''),
          v_fase, v_es_prueba, case when v_es_prueba then 'heredado' else 'manual' end)
  returning id into v_id;

  select usuario_id into v_a_usuario from sgc.conductores where id = p_a_conductor_id;
  select nombre into v_de_nombre from sgc.usuarios where id = v_uid;
  if v_a_usuario is not null then
    perform sgc.notificar(v_a_usuario, 'transporte',
      'Te ofrecen un conduce',
      format('%s quiere transferirte la responsabilidad de un conduce. Revísalo y acéptalo con foto y firma.',
             coalesce(v_de_nombre,'Un chofer')),
      '/transporte/conduces');
  end if;

  return v_id;
end;
$function$;

-- ── 4) El receptor no puede firmar antes de que el conduce llegue ────────────────
create or replace function sgc.firmar_conduce(p_salida_id uuid, p_rol text, p_nombre text, p_firma_path text, p_cedula text default null, p_rol_desc text default null, p_metodo text default 'pad', p_usuario_id uuid default null, p_foto_path text default null, p_nota text default null)
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
             or (s.despachante_usuario_id = v_uid and sgc.es_despachante_elegible(v_uid)))
    )
  ) then
    raise exception 'No tienes permiso para firmar este conduce';
  end if;

  -- CM4: el RECEPTOR no puede firmar antes de que el conduce llegue (emitido / en ruta).
  if v_rol = 'receptor' and sgc.conduce_fase(p_salida_id) in ('emitido','en_transito') then
    raise exception 'Todavía no ha llegado. Podrás firmar cuando el chofer lo entregue.' using errcode = 'DR424';
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
       set firma_pendiente_usuario_id = null,
           firma_pendiente_nombre     = null,
           firma_pendiente_almacen    = false,
           recepcion_foto_path        = coalesce(nullif(p_foto_path,''), recepcion_foto_path),
           notas_recepcion            = coalesce(nullif(p_nota,''), notas_recepcion)
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

commit;
