-- BK4 — Reporte DIARIO de incentivo (8am RD). Informativo, aparte del semanal.
-- NO toca materia de pago: no escribe en incentivo_semana, incentivo_envio ni
-- incentivo_informe_version. Tabla propia incentivo_dia (AT11: la data enviada se
-- ve en la app). El diario mide ACTIVIDAD del día (eventos crudos ponderados por
-- los pesos vigentes); NO aplica la cuarentena/incidencias del semanal (eso es del
-- proceso de pago) ni marca "cumplió". Cron 0 12 * * * = 8am RD (RD sin DST).
--
-- Nota: incentivo_cron_lunes() NO tiene el bug de isoweek que sugería el apunte —
-- en PostgreSQL EXTRACT(WEEK) ya es la semana ISO y EXTRACT(ISOYEAR) el año ISO,
-- así que el par (isoyear, week) concuerda con 'IYYY-IW'. Se deja como está.

begin;

-- ── 1) Tabla del diario (separada de incentivo_semana = materia de pago) ─────
create table if not exists sgc.incentivo_dia (
  fecha        date not null,
  usuario_id   uuid not null references sgc.usuarios(id) on delete cascade,
  conductor_id uuid,
  puntaje      numeric not null default 0,
  conteos      jsonb   not null default '{}'::jsonb,
  generado_at  timestamptz not null default now(),
  primary key (fecha, usuario_id)
);
alter table sgc.incentivo_dia enable row level security;
drop policy if exists "incentivo_dia: lectura" on sgc.incentivo_dia;
create policy "incentivo_dia: lectura" on sgc.incentivo_dia
  for select to authenticated
  using (sgc.is_admin() or sgc.puede_gestionar_incentivos() or usuario_id = auth.uid());
grant select on sgc.incentivo_dia to authenticated, service_role;

-- ── 2) Destinatarios del diario: parámetro PROPIO (un correo diario cansa) ───
insert into sgc.parametros (clave, valor, descripcion) values
  ('incentivo_diario_roles','admin,direccion,logistica,jefe_flota','Roles que reciben el informe DIARIO de incentivo (CSV de códigos)')
on conflict (clave) do nothing;

create or replace function sgc.destinatarios_informe_diario()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and r.codigo = any (sgc.param_csv('incentivo_diario_roles','admin,direccion,logistica,jefe_flota'));
$function$;
grant execute on function sgc.destinatarios_informe_diario() to authenticated, service_role;

-- ── 3) Generador del día: actividad cruda ponderada, gate por padrón ─────────
create or replace function sgc.incentivo_generar_dia(p_fecha date)
returns integer language plpgsql security definer set search_path to 'sgc', 'public'
as $function$
declare
  v_cfg    sgc.incentivo_config%rowtype;
  v_factor numeric;
  v_count  int := 0;
begin
  select * into v_cfg from sgc.incentivo_config where activo order by version desc limit 1;
  if not found then raise exception 'No hay configuración de incentivo activa' using errcode = 'AT404'; end if;
  v_factor := coalesce(v_cfg.ayudante_factor, 1);

  with titulares as (
    select ck.creado_por as usuario_id, 'reporte_semanal'::text as renglon, ck.id as ref_id, ck.fecha as ref_fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia = 'semanal' and not ck.es_prueba and ck.creado_por is not null and ck.fecha = p_fecha
    union all
    select ck.creado_por, 'inspeccion', ck.id, ck.fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia <> 'semanal' and not ck.es_prueba and ck.creado_por is not null and ck.fecha = p_fecha
    union all
    select rc.registrado_por, 'echada', rc.id, rc.fecha
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null and not coalesce(rc.invalidada, false)
       and coalesce(nullif(trim(rc.foto_tablero_path), ''), null) is not null and rc.fecha = p_fecha
    union all
    select coalesce(c.usuario_id, r.creado_por), 'ruta', r.id, r.fecha
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
     where r.estado = 'completada' and not r.es_prueba and not coalesce(r.derivada_de_conduce, false)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) = p_fecha
       and coalesce(c.usuario_id, r.creado_por) is not null
    union all
    select coalesce(c.usuario_id, s.entregado_por), 'conduce', s.id, s.fecha
      from sgc.salidas_inventario s
      left join sgc.conductores c on c.id = s.conductor_id
     where s.recibido_por is not null and not s.es_prueba
       and coalesce((s.recibido_en at time zone 'America/Santo_Domingo')::date,
                    (s.entregado_en at time zone 'America/Santo_Domingo')::date, s.fecha) = p_fecha
       and coalesce(c.usuario_id, s.entregado_por) is not null
  ),
  ayudantes as (
    select ap.usuario_id, t.renglon, t.ref_id, t.ref_fecha
      from sgc.actividad_participantes ap
      join titulares t on t.renglon = ap.activity_type and t.ref_id = ap.activity_id
     where ap.rol = 'helper'
  ),
  eventos as (
    select usuario_id, renglon, ref_id, ref_fecha, false as es_ayudante from titulares
    union all
    select usuario_id, renglon, ref_id, ref_fecha, true  as es_ayudante from ayudantes
  ),
  por_renglon as (
    select e.usuario_id, e.renglon,
           count(*) filter (where not e.es_ayudante) as propio,
           count(*) filter (where e.es_ayudante)     as ayudante,
           (count(*) filter (where not e.es_ayudante)
            + count(*) filter (where e.es_ayudante) * v_factor)
             * coalesce((v_cfg.pesos->>e.renglon)::numeric, 0) as puntos
      from eventos e group by e.usuario_id, e.renglon
  ),
  agg as (
    select usuario_id,
           jsonb_object_agg(renglon, jsonb_build_object('propio', propio, 'ayudante', ayudante, 'puntos', puntos)) as conteos,
           sum(puntos) as puntaje
      from por_renglon group by usuario_id
  )
  insert into sgc.incentivo_dia as ins (fecha, usuario_id, conductor_id, puntaje, conteos, generado_at)
  select p_fecha, a.usuario_id,
         (select id from sgc.conductores c where c.usuario_id = a.usuario_id limit 1),
         coalesce(a.puntaje, 0), coalesce(a.conteos, '{}'::jsonb), now()
    from agg a
   where exists (select 1 from sgc.incentivo_participante ip where ip.usuario_id = a.usuario_id and ip.es_chofer)
  on conflict (fecha, usuario_id) do update
    set puntaje = excluded.puntaje, conteos = excluded.conteos, generado_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
grant execute on function sgc.incentivo_generar_dia(date) to authenticated, service_role;

-- ── 4) Lectura para la vista in-app (AT11) ──────────────────────────────────
create or replace function sgc.incentivo_dia_listado(p_fecha date)
returns table(usuario_id uuid, nombre text, puntaje numeric, conteos jsonb)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select d.usuario_id, u.nombre, d.puntaje, d.conteos
    from sgc.incentivo_dia d
    join sgc.usuarios u on u.id = d.usuario_id
   where d.fecha = p_fecha
     and (sgc.is_admin() or sgc.puede_gestionar_incentivos())
   order by d.puntaje desc, u.nombre;
$function$;
grant execute on function sgc.incentivo_dia_listado(date) to authenticated, service_role;

-- ── 5) Cron diario: genera el día ANTERIOR y dispara el correo (fuera de pago) ─
create or replace function sgc.incentivo_cron_diario()
returns void language plpgsql security definer set search_path to 'sgc', 'public'
as $function$
declare v_fecha date := (now() at time zone 'America/Santo_Domingo')::date - 1; v_secret text;
begin
  perform sgc.incentivo_generar_dia(v_fecha);
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  begin
    perform net.http_post(
      url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/incentivo-diario',
      headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('fecha', v_fecha::text)
    );
  exception when others then null; end;
end;
$function$;

commit;
