-- ============================================================================
-- PROMPT-25 (AW) — Ronda 21/08/2026.
-- AW16 (server): aviso "vehículo en uso de X" + traspaso trazado.
--   • Los RPC que exponen el estado en-uso incluyen `color` para la
--     identificación AT9 (Marca · Color · Placa) en el selector.
--   • Al RECIBIR un vehículo que otro tenía en uso, además de avisar al tenedor
--     anterior, se avisa al JEFE DE FLOTA (flota elevado). NUNCA bloquea: solo
--     avisa y registra el traspaso completo (quién lo tenía = recibido_de, quién
--     recibe = usuario_id, cuándo = inicio_at/fin_at).
-- Aditivo / idempotente / retrocompatible. Contratos para la app (PROMPT-26).
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-21-aw16-vehiculo-en-uso-aviso.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) iniciar_uso_vehiculo: +aviso al jefe de flota en el traspaso ─────────
create or replace function sgc.iniciar_uso_vehiculo(
  p_vehiculo_id uuid,
  p_km          numeric default null,
  p_nivel       text    default null,
  p_notas       text    default null,
  p_recibir     boolean default false
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_v sgc.vehiculos%rowtype;
  v_activa sgc.vehiculo_usos%rowtype;
  v_uso_id uuid;
  v_prev uuid;
  v_prev_nombre text;
  v_mi_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_conductor_ampliado(v_uid)) then
    raise exception 'Tu usuario no puede tomar vehículos en uso.' using errcode = '42501';
  end if;

  select * into v_v from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;
  if not coalesce(v_v.activo, true) then raise exception 'Vehículo inactivo.'; end if;

  select * into v_activa from sgc.vehiculo_usos where vehiculo_id = p_vehiculo_id and fin_at is null limit 1;

  if found and v_activa.usuario_id = v_uid then
    return jsonb_build_object('ok', true, 'estado', 'ya_en_uso', 'uso_id', v_activa.id, 'vehiculo_id', p_vehiculo_id);
  end if;

  if found and v_activa.usuario_id <> v_uid then
    if not p_recibir then
      select nombre into v_prev_nombre from sgc.usuarios where id = v_activa.usuario_id;
      raise exception 'El vehículo está en uso por %.', coalesce(v_prev_nombre,'otro usuario')
        using errcode = 'DR409',
              detail = jsonb_build_object('en_uso_por', v_activa.usuario_id, 'nombre', v_prev_nombre, 'desde', v_activa.inicio_at)::text;
    end if;
    v_prev := v_activa.usuario_id;
    update sgc.vehiculo_usos
      set fin_at = now(),
          km_fin = coalesce(p_km, km_fin),
          nivel_combustible_fin = coalesce(nivel_combustible_fin, v_activa.nivel_combustible_inicio),
          notas = concat_ws(' · ', notas, 'Recibido por otro usuario')
      where id = v_activa.id;
    update sgc.vehiculo_entregas
      set estado = 'cerrada'
      where vehiculo_id = p_vehiculo_id and conductor_usuario_id = v_prev
        and tipo = 'recepcion' and estado = 'abierta';
  end if;

  insert into sgc.vehiculo_usos (vehiculo_id, usuario_id, km_inicio, nivel_combustible_inicio, recibido_de, notas, es_prueba)
  values (p_vehiculo_id, v_uid, p_km, nullif(p_nivel,''), v_prev, p_notas, coalesce(v_v.es_prueba, false))
  returning id into v_uso_id;

  update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;
  if p_km is not null then
    begin perform sgc.avanzar_odometro(p_vehiculo_id, p_km::int); exception when others then null; end;
  end if;
  perform sgc.asegurar_conductor_de_usuario(v_uid);

  -- AW16 — traspaso: avisa al tenedor anterior Y al jefe de flota (elevados).
  if v_prev is not null then
    select nombre into v_prev_nombre from sgc.usuarios where id = v_prev;
    select nombre into v_mi_nombre from sgc.usuarios where id = v_uid;
    perform sgc.notificar(v_prev, 'flota', 'Tu vehículo fue recibido',
      coalesce(v_mi_nombre,'Otro usuario')||' recibió el vehículo '||coalesce(v_v.placa,'')||' que tenías en uso.',
      '/flota/mi-actividad');
    begin
      perform sgc.notificar_flota_elevado('flota', 'Traspaso de vehículo en uso',
        coalesce(v_mi_nombre,'Alguien')||' recibió '||trim(coalesce(v_v.marca,'')||' '||coalesce(v_v.placa,''))||
        ' de '||coalesce(v_prev_nombre,'otro usuario')||'.',
        '/flota/seguimiento');
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true,
    'estado', case when v_prev is not null then 'recibido' else 'iniciado' end,
    'uso_id', v_uso_id, 'vehiculo_id', p_vehiculo_id, 'recibido_de', v_prev);
end;
$$;
grant execute on function sgc.iniciar_uso_vehiculo(uuid, numeric, text, text, boolean) to authenticated, service_role;

-- ── 2) estado_uso_vehiculo: +color (identificación AT9) ─────────────────────
create or replace function sgc.estado_uso_vehiculo(p_vehiculo_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce((
    select jsonb_build_object(
      'libre', false, 'usuario_id', vu.usuario_id,
      'usuario_nombre', u.nombre, 'desde', vu.inicio_at,
      'km_inicio', vu.km_inicio, 'nivel_inicio', vu.nivel_combustible_inicio,
      'marca', v.marca, 'modelo', v.modelo, 'color', v.color, 'placa', v.placa,
      'es_mio', (vu.usuario_id = auth.uid()))
    from sgc.vehiculo_usos vu
    join sgc.usuarios u on u.id = vu.usuario_id
    join sgc.vehiculos v on v.id = vu.vehiculo_id
    where vu.vehiculo_id = p_vehiculo_id and vu.fin_at is null limit 1
  ), jsonb_build_object('libre', true));
$$;
grant execute on function sgc.estado_uso_vehiculo(uuid) to authenticated, service_role;

-- ── 3) vehiculos_en_uso: +color (identificación AT9) ────────────────────────
drop function if exists sgc.vehiculos_en_uso();
create or replace function sgc.vehiculos_en_uso()
returns table (vehiculo_id uuid, placa text, marca text, modelo text, color text,
               usuario_id uuid, usuario_nombre text, desde timestamptz, km_inicio numeric, nivel_inicio text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select v.id, v.placa, v.marca, v.modelo, v.color, vu.usuario_id, u.nombre, vu.inicio_at, vu.km_inicio, vu.nivel_combustible_inicio
  from sgc.vehiculo_usos vu
  join sgc.vehiculos v on v.id = vu.vehiculo_id
  join sgc.usuarios u on u.id = vu.usuario_id
  where vu.fin_at is null
    and (sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia())
    and ((not coalesce(v.es_prueba,false)) or sgc.is_admin())
  order by vu.inicio_at desc;
$$;
grant execute on function sgc.vehiculos_en_uso() to authenticated, service_role;
