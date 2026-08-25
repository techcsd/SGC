-- ════════════════════════════════════════════════════════════════════════════
-- AX4 — Aviso preventivo "¿Sigues en ruta?" (extiende AV6 recordar_estados_chofer)
-- ════════════════════════════════════════════════════════════════════════════
-- El apunte de AX4 pide avisar ANTES de penalizar: "llevas 8 h en ruta sin
-- actualizar — ¿sigues en ruta?". AV6 ya cubre los estados ociosos (inactivo > 4h,
-- disponible > 12h) con push por hora; le faltaba SOLO el caso 'en_ruta'. Esto lo
-- añade reutilizando TODO lo de AV6 (tabla dedup chofer_estado_aviso, cron
-- sgc-recordar-estados-chofer, sgc.notificar/push AF7, es_prueba excluido). Aditivo
-- y retrocompatible: solo agrega un parámetro + una rama; no toca las existentes.
-- Depende de AV6 (2026-08-20-av6-recordatorios-estado-chofer.sql), ya en prod.
-- ════════════════════════════════════════════════════════════════════════════

-- Umbral configurable (horas "en ruta" sin actualizar antes de avisar).
insert into sgc.parametros (clave, valor) values ('estado_en_ruta_horas', '8')
on conflict (clave) do nothing;

create or replace function sgc.recordar_estados_chofer()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_h_inactivo   numeric := coalesce((select nullif(valor,'')::numeric from sgc.parametros where clave='estado_inactivo_horas'), 4);
  v_h_disponible numeric := coalesce((select nullif(valor,'')::numeric from sgc.parametros where clave='estado_disponible_horas'), 12);
  v_h_en_ruta    numeric := coalesce((select nullif(valor,'')::numeric from sgc.parametros where clave='estado_en_ruta_horas'), 8);
  v_hora_ini     int := coalesce((select nullif(valor,'')::int from sgc.parametros where clave='estado_horario_inicio'), 7);
  v_hora_fin     int := coalesce((select nullif(valor,'')::int from sgc.parametros where clave='estado_horario_fin'), 18);
  v_hora_rd      int := extract(hour from (now() at time zone 'America/Santo_Domingo'))::int;
  v_laboral      boolean;
  v_n            int := 0;
  r              record;
begin
  v_laboral := v_hora_rd >= v_hora_ini and v_hora_rd < v_hora_fin;

  for r in
    select c.usuario_id, e.estado, e.desde,
           round(extract(epoch from (now() - e.desde))/3600.0, 1) as horas
    from sgc.chofer_estado e
    join sgc.conductores c on c.usuario_id = e.usuario_id
    where c.usuario_id is not null
      and coalesce(c.activo, true)
      and not coalesce(c.es_prueba, false)
      and e.estado in ('inactivo','disponible','en_ruta')
  loop
    -- inactivo demasiado tiempo (solo en horario laboral)
    if r.estado = 'inactivo' and v_laboral and r.horas >= v_h_inactivo then
      insert into sgc.chofer_estado_aviso (usuario_id, estado, tipo)
      values (r.usuario_id, 'inactivo', 'inactivo')
      on conflict do nothing;
      if found then
        perform sgc.notificar(r.usuario_id, 'info', 'Actualiza tu estado',
          format('Llevas %s h como "Inactivo". Recuerda actualizar tu estado.', trim(to_char(r.horas,'FM990.0'))),
          '/mi-actividad');
        v_n := v_n + 1;
      end if;

    -- AX4 — en ruta demasiado tiempo sin actualizar → "¿Sigues en ruta?" (horario laboral).
    -- Actualizar el estado / cerrar la ruta es una SEÑAL que evita la penalización por
    -- estancamiento (mismo comportamiento que queremos incentivar).
    elsif r.estado = 'en_ruta' and v_laboral and r.horas >= v_h_en_ruta then
      insert into sgc.chofer_estado_aviso (usuario_id, estado, tipo)
      values (r.usuario_id, 'en_ruta', 'en_ruta')
      on conflict do nothing;
      if found then
        perform sgc.notificar(r.usuario_id, 'warning', '¿Sigues en ruta?',
          format('Llevas %s h "En ruta" sin actualizar. Si ya terminaste, cierra la ruta o cambia tu estado.', trim(to_char(r.horas,'FM990.0'))),
          '/mi-actividad');
        v_n := v_n + 1;
      end if;

    -- disponible demasiado tiempo (aviso al chofer + jefe de flota)
    elsif r.estado = 'disponible' and r.horas >= v_h_disponible then
      insert into sgc.chofer_estado_aviso (usuario_id, estado, tipo)
      values (r.usuario_id, 'disponible', 'disponible')
      on conflict do nothing;
      if found then
        perform sgc.notificar(r.usuario_id, 'info', 'Actualiza tu estado',
          format('Llevas %s h como "Disponible". Si terminaste tu jornada, ponte en "Inactivo".', trim(to_char(r.horas,'FM990.0'))),
          '/mi-actividad');
        perform sgc.notificar_flota_elevado('info', 'Chofer mucho tiempo disponible',
          format('%s lleva %s h en "Disponible".', coalesce((select nombre from sgc.usuarios where id=r.usuario_id),'Un chofer'), trim(to_char(r.horas,'FM990.0'))),
          '/flota/rutas-activas');
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  return v_n;
end;
$$;
grant execute on function sgc.recordar_estados_chofer() to service_role;
comment on function sgc.recordar_estados_chofer() is
  'AV6+AX4 — recuerda a los choferes con demasiado tiempo en inactivo (laboral), en_ruta (¿sigues en ruta?, laboral) o disponible (aviso también al jefe de flota). Anti-spam 1/día por (usuario,estado,tipo), es_prueba excluido.';

-- El cron sgc-recordar-estados-chofer (cada hora, minuto 5) ya está registrado por
-- AV6 y ahora ejecuta la versión extendida — no hace falta reprogramarlo.
