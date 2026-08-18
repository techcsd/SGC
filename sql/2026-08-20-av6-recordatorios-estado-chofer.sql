-- ════════════════════════════════════════════════════════════════════════════
-- AV6 — Recordatorios de estado del chofer
-- ════════════════════════════════════════════════════════════════════════════
-- Un chofer que dura mucho "inactivo" o mucho "disponible" (ej. 20h) debe recibir
-- un recordatorio. Reutiliza la infra push (AF7) y el cron (Y17).
--   • inactivo > N horas (default 4) en horario laboral → push al chofer.
--   • disponible > M horas (default 12) → push al chofer + aviso al jefe de flota.
-- Anti-spam: máximo 1 recordatorio por (usuario, estado) por día. es_prueba
-- excluido. Umbrales y horario configurables por sgc.parametros.
-- Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

-- Parámetros configurables.
insert into sgc.parametros (clave, valor) values
  ('estado_inactivo_horas',   '4'),
  ('estado_disponible_horas', '12'),
  ('estado_horario_inicio',   '7'),    -- hora RD (0-23) inicio jornada
  ('estado_horario_fin',      '18')    -- hora RD (0-23) fin jornada
on conflict (clave) do nothing;

-- Dedup: un aviso por (usuario, estado) por día.
create table if not exists sgc.chofer_estado_aviso (
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  estado     text not null,
  fecha      date not null default (now() at time zone 'America/Santo_Domingo')::date,
  tipo       text not null,           -- 'inactivo' | 'disponible'
  created_at timestamptz not null default now(),
  primary key (usuario_id, estado, fecha, tipo)
);
comment on table sgc.chofer_estado_aviso is
  'AV6 — dedup de recordatorios de estado del chofer: una entrada por (usuario, estado, día, tipo).';
alter table sgc.chofer_estado_aviso enable row level security;
grant select, insert on sgc.chofer_estado_aviso to service_role;

-- ── Sweep: recorre estados y recuerda a quien lleva demasiado tiempo ──────────
create or replace function sgc.recordar_estados_chofer()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_h_inactivo   numeric := coalesce((select nullif(valor,'')::numeric from sgc.parametros where clave='estado_inactivo_horas'), 4);
  v_h_disponible numeric := coalesce((select nullif(valor,'')::numeric from sgc.parametros where clave='estado_disponible_horas'), 12);
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
      and e.estado in ('inactivo','disponible')
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
  'AV6 — recuerda a los choferes que llevan demasiado tiempo inactivo (horario laboral) o disponible (aviso también al jefe de flota). Anti-spam 1/día por estado, es_prueba excluido.';

-- ── Cron: cada hora en punto (evalúa horario/umbrales internamente) ───────────
do $$ begin perform cron.unschedule('sgc-recordar-estados-chofer'); exception when others then null; end $$;
select cron.schedule('sgc-recordar-estados-chofer', '5 * * * *',
  $cron$ select sgc.recordar_estados_chofer(); $cron$);
