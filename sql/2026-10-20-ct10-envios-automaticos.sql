-- 2026-10-20-ct10-envios-automaticos.sql — CT10 (fila 269, segunda parte)
-- Xaviel recibe cada lunes el "Resumen semanal de operaciones" y otros correos
-- automáticos de dev (redirigidos a su correo real por `ajustarCorreoResend`,
-- con asunto [DEV → ...] — no le llegan a nadie más, pero son ruido cuando no
-- está probando nada de eso). No existía ningún interruptor: lo único posible
-- era desprogramar el cron a mano. Esta migración agrega una tabla de config
-- por familia + un gate en cada punto de entrada de cron.
--
-- "DEV nace apagado, PROD nace encendido" usa el MISMO patrón ya establecido
-- por BU1 (sql/2026-09-18-bu1-crons-por-entorno.sql): `sgc.config_entorno`
-- (clave='entorno') ya tiene 'dev'/'prod' poblado por entorno — el default de
-- `activo` se calcula a partir de esa fila, así que ESTE MISMO archivo aplica
-- igual (mismo checksum) en dev y en prod, sin ningún `if` manual por entorno.
begin;

create table if not exists sgc.envios_automaticos (
  familia              text primary key,
  nombre               text not null,
  activo               boolean not null default true,
  ultimo_envio         timestamptz,
  motivo_ultimo_cambio text,
  cambiado_por         uuid references sgc.usuarios(id),
  updated_at           timestamptz not null default now()
);
comment on table sgc.envios_automaticos is
  'CT10 — interruptor por familia de reporte/aviso automático (crons). Los crons consultan sgc.envio_automatico_activo() en un solo lugar.';

alter table sgc.envios_automaticos enable row level security;
drop policy if exists envios_automaticos_sel on sgc.envios_automaticos;
create policy envios_automaticos_sel on sgc.envios_automaticos for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.envios_automaticos to authenticated;
grant all on sgc.envios_automaticos to service_role;

insert into sgc.envios_automaticos (familia, nombre, activo) values
  ('resumen_operaciones',   'Resumen semanal de operaciones',          (select coalesce(valor,'') <> 'dev' from sgc.config_entorno where clave = 'entorno')),
  ('incentivo_semanal',     'Incentivo semanal',                       (select coalesce(valor,'') <> 'dev' from sgc.config_entorno where clave = 'entorno')),
  ('avisos_reporte_semanal','Avisos de reporte semanal (flota)',       (select coalesce(valor,'') <> 'dev' from sgc.config_entorno where clave = 'entorno')),
  ('cronograma',            'Avisos y correos de cronograma de obra',  (select coalesce(valor,'') <> 'dev' from sgc.config_entorno where clave = 'entorno'))
on conflict (familia) do nothing;

create or replace function sgc.envio_automatico_activo(p_familia text) returns boolean
language sql stable
set search_path to 'sgc', 'pg_temp'
as $$
  -- Familia no registrada todavía → no bloquea (falla abierto a "como siempre").
  select coalesce((select activo from sgc.envios_automaticos where familia = p_familia), true);
$$;
grant execute on function sgc.envio_automatico_activo(text) to authenticated, service_role;

create or replace function sgc.envios_automaticos_listar()
returns setof sgc.envios_automaticos
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select * from sgc.envios_automaticos order by nombre;
$$;
grant execute on function sgc.envios_automaticos_listar() to authenticated;

-- ── RPC: encender/apagar una familia. Apagar en PROD exige motivo (auditado). ──
create or replace function sgc.envio_automatico_set(p_familia text, p_activo boolean, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_es_prod boolean;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede cambiar los envíos automáticos.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.envios_automaticos where familia = p_familia) then
    raise exception 'Familia desconocida: %', p_familia using errcode = '22023';
  end if;

  select coalesce(valor, '') = 'prod' into v_es_prod from sgc.config_entorno where clave = 'entorno';
  if v_es_prod and not p_activo and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Apagar un envío automático en producción exige un motivo.' using errcode = '22023';
  end if;

  update sgc.envios_automaticos set
    activo = p_activo,
    motivo_ultimo_cambio = nullif(trim(p_motivo), ''),
    cambiado_por = auth.uid(),
    updated_at = now()
  where familia = p_familia;
end;
$$;
grant execute on function sgc.envio_automatico_set(text, boolean, text) to authenticated;

create or replace function sgc.envio_automatico_marcar_enviado(p_familia text) returns void
language sql
set search_path to 'sgc', 'pg_temp'
as $$
  update sgc.envios_automaticos set ultimo_envio = now() where familia = p_familia;
$$;
grant execute on function sgc.envio_automatico_marcar_enviado(text) to service_role;

-- ── Gate en los 4 puntos de entrada de cron (regla 19: cuerpo igual al de prod,
-- solo se agrega el chequeo al inicio + la marca de "último envío"). ──
create or replace function sgc.resumen_operaciones_cron_lunes()
returns void
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int  := extract(isoyear from v_ref)::int;
  v_sem  int  := extract(week from v_ref)::int;
begin
  if not sgc.envio_automatico_activo('resumen_operaciones') then return; end if;
  perform sgc.resumen_operaciones_enviar_semana(v_anio, v_sem, false);
  perform sgc.envio_automatico_marcar_enviado('resumen_operaciones');
end;
$function$;

create or replace function sgc.incentivo_cron_lunes()
returns void
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int  := extract(isoyear from v_ref)::int;
  v_sem  int  := extract(week    from v_ref)::int;
begin
  if not sgc.envio_automatico_activo('incentivo_semanal') then return; end if;
  perform sgc.incentivo_generar_semana(v_anio, v_sem);
  perform sgc.incentivo_enviar_semana(v_anio, v_sem, false);
  perform sgc.envio_automatico_marcar_enviado('incentivo_semanal');
end;
$function$;

create or replace function sgc.sweep_avisos_reporte_semanal()
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_inicio date := date_trunc('week', current_date)::date;
  v_anio   int  := extract(isoyear from current_date)::int;
  v_sem    int  := extract(week from current_date)::int;
  v_dow    int  := extract(dow from current_date)::int;
  v_n      int  := 0;
begin
  if not sgc.envio_automatico_activo('avisos_reporte_semanal') then return 0; end if;

  insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, mensaje, severidad, dedup_key)
  select 'reporte_semanal', v.id, asg.conductor_id,
         format('Hoy toca el reporte semanal de %s. Aún no se ha registrado esta semana.', v.placa),
         'media',
         format('reporte_semanal_dia:%s:%s-%s', v.id, v_anio, v_sem)
    from sgc.vehiculos v
    left join lateral (
      select va.conductor_id from sgc.vehiculo_asignaciones va
       where va.vehiculo_id = v.id and va.activa
       order by va.desde desc limit 1
    ) asg on true
   where coalesce(v.activo, true) and v.estado <> 'baja'
     and sgc.dia_reporte_dow(v.id) = v_dow
     and not exists (
       select 1 from sgc.checklists_vehiculo c
        join sgc.checklist_plantillas p on p.id = c.plantilla_id
       where c.vehiculo_id = v.id and p.frecuencia = 'semanal'
         and c.fecha >= v_inicio and c.fecha < v_inicio + 7
     )
     and not exists (
       select 1 from sgc.avisos_flota a
       where a.dedup_key = format('reporte_semanal_dia:%s:%s-%s', v.id, v_anio, v_sem)
     );
  get diagnostics v_n = row_count;
  perform sgc.envio_automatico_marcar_enviado('avisos_reporte_semanal');
  return v_n;
end;
$function$;

create or replace function sgc.evaluar_avisos_cronograma()
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'public', 'vault'
as $function$
declare
  r record;
  v_kind text;
  v_sev text;
  v_msg text;
  v_dedup text;
  v_was_insert boolean;
  v_n int := 0;
  v_secret text;
  v_proj_ref text := '';
  resp record;
begin
  if not sgc.envio_automatico_activo('cronograma') then return 0; end if;

  update sgc.avisos_proyecto a
    set estado='resuelto_auto', resuelto_at=now(), resuelto_nota='Tarea completada'
  where a.tipo like 'cronograma_%' and a.estado='pendiente'
    and a.referencia_id in (select id from sgc.cronograma_tareas where estado='completada');
  update sgc.avisos_proyecto a
    set estado='resuelto_auto', resuelto_at=now(), resuelto_nota='Tarea iniciada'
  where a.tipo='cronograma_por_iniciar' and a.estado='pendiente'
    and a.referencia_id in (select id from sgc.cronograma_tareas where estado<>'pendiente');

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name='cronograma_sync_secret';
  exception when others then v_secret := null; end;

  for r in
    select t.*, p.nombre as proyecto_nombre
    from sgc.cronograma_tareas t
    join sgc.proyectos p on p.id = t.proyecto_id
    where t.estado <> 'completada'
      and not t.es_prueba
      and coalesce(p.activo, true)
      and p.estado not in ('completado','cancelado')
  loop
    v_kind := null;
    if r.estado = 'pendiente' and r.fecha_inicio_plan is not null
       and r.fecha_inicio_plan between current_date and current_date + 3 then
      v_kind := 'por_iniciar'; v_sev := 'media';
      v_msg := 'La tarea «'||r.nombre||'» inicia el '||to_char(r.fecha_inicio_plan,'DD/MM/YYYY')||'.';
    end if;
    if r.fecha_fin_plan is not null and r.fecha_fin_plan < current_date then
      v_kind := 'atrasada'; v_sev := 'alta';
      v_msg := 'La tarea «'||r.nombre||'» está atrasada (vencía el '||to_char(r.fecha_fin_plan,'DD/MM/YYYY')||'). Requiere justificación.';
    elsif r.fecha_fin_plan is not null and r.fecha_fin_plan between current_date and current_date + 2 then
      v_kind := 'por_vencer'; v_sev := 'media';
      v_msg := 'La tarea «'||r.nombre||'» vence el '||to_char(r.fecha_fin_plan,'DD/MM/YYYY')||'.';
    end if;

    if v_kind is null then continue; end if;

    v_dedup := 'crono:'||r.id||':'||v_kind;
    insert into sgc.avisos_proyecto (tipo, proyecto_id, referencia_id, mensaje, severidad, estado, dedup_key)
    values ('cronograma_'||v_kind, r.proyecto_id, r.id, v_msg, v_sev, 'pendiente', v_dedup)
    on conflict (dedup_key) where dedup_key is not null do update
      set mensaje = excluded.mensaje, severidad = excluded.severidad,
          estado = case when sgc.avisos_proyecto.estado = 'resuelto_auto' then 'pendiente' else sgc.avisos_proyecto.estado end
    returning (xmax = 0) into v_was_insert;

    if v_was_insert then
      v_n := v_n + 1;
      for resp in
        select pr.usuario_id from sgc.proyecto_responsables pr
        where pr.proyecto_id = r.proyecto_id and pr.activo
      loop
        perform sgc.notificar(resp.usuario_id, case when v_kind='atrasada' then 'error' else 'warning' end,
          'Cronograma: '||r.proyecto_nombre, v_msg,
          '/proyectos/'||r.proyecto_id||'/cronograma?tarea='||r.id);
      end loop;

      if v_secret is not null then
        begin
          perform net.http_post(
            url := 'https://'||v_proj_ref||'.supabase.co/functions/v1/notificar-cronograma',
            headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
            body := jsonb_build_object('proyecto_id', r.proyecto_id, 'tarea_id', r.id,
                     'tipo', v_kind, 'tarea', r.nombre, 'proyecto', r.proyecto_nombre, 'mensaje', v_msg)
          );
          update sgc.avisos_proyecto set email_enviado_at = now() where dedup_key = v_dedup;
        exception when others then null; end;
      end if;
    end if;
  end loop;

  perform sgc.envio_automatico_marcar_enviado('cronograma');
  return v_n;
end;
$function$;

commit;
