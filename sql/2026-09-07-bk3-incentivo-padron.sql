-- BK3 — Padrón de Desempeño con llave en USUARIOS (no en conductores).
-- Permite incluir a alguien que no tiene el rol chofer_transportista (Misael:
-- jefe_flota, logistica) y marcar "es chofer o no" como DATO, no como rol.
--
-- Materia de pago: el backfill hace es_chofer = quienes hoy tienen el rol, así el
-- conjunto puntuado NO cambia al aplicar. Marcar es_chofer NO otorga el rol (§F):
-- sólo declara la condición para el incentivo. Sin regeneración de histórico (§F):
-- quien se agregue puntúa desde la semana en curso hacia adelante.
--
-- Aplicar con dry-run (begin/rollback) primero. Alto blast-radius (scoring).

begin;

-- ── 1) Padrón ───────────────────────────────────────────────────────────────
create table if not exists sgc.incentivo_participante (
  usuario_id      uuid primary key references sgc.usuarios(id) on delete cascade,
  participa       boolean not null default true,
  es_chofer       boolean not null default false,
  motivo          text,
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now()
);
alter table sgc.incentivo_participante enable row level security;
drop policy if exists "incentivo_participante: gestion" on sgc.incentivo_participante;
create policy "incentivo_participante: gestion" on sgc.incentivo_participante
  for select to authenticated
  using (sgc.is_admin() or sgc.puede_gestionar_incentivos() or usuario_id = auth.uid());
grant select on sgc.incentivo_participante to authenticated, service_role;

-- Backfill behavior-preserving: es_chofer = tiene el rol hoy; participa = su flag
-- en conductores (o true). Cubre choferes por rol y conductores activos.
insert into sgc.incentivo_participante (usuario_id, participa, es_chofer)
select u.id,
       coalesce((select c.participa_incentivo from sgc.conductores c
                  where c.usuario_id = u.id order by coalesce(c.activo,true) desc limit 1), true),
       exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
               where ur.usuario_id = u.id and r.codigo = 'chofer_transportista')
from sgc.usuarios u
where exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id and r.codigo = 'chofer_transportista')
   or exists (select 1 from sgc.conductores c where c.usuario_id = u.id and coalesce(c.activo, true))
on conflict (usuario_id) do nothing;

-- Auditoría: admite entradas por usuario (sin conductor) + es_chofer.
alter table sgc.incentivo_participante_audit alter column conductor_id drop not null;
alter table sgc.incentivo_participante_audit add column if not exists es_chofer boolean;

-- ── 2) Setter por usuario (agregar persona / marcar es_chofer / participa) ───
create or replace function sgc.set_incentivo_participante(
  p_usuario_id uuid, p_participa boolean, p_es_chofer boolean, p_motivo text default null)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_p boolean; v_e boolean;
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_incentivos()) then
    raise exception 'No tienes permiso para gestionar el padrón de incentivo.';
  end if;
  if p_usuario_id is null then raise exception 'Usuario requerido.'; end if;

  select participa, es_chofer into v_p, v_e from sgc.incentivo_participante where usuario_id = p_usuario_id;

  insert into sgc.incentivo_participante (usuario_id, participa, es_chofer, motivo, actualizado_por, actualizado_en)
  values (p_usuario_id, coalesce(p_participa,true), coalesce(p_es_chofer,false), nullif(trim(p_motivo),''), auth.uid(), now())
  on conflict (usuario_id) do update
    set participa = excluded.participa, es_chofer = excluded.es_chofer,
        motivo = excluded.motivo, actualizado_por = auth.uid(), actualizado_en = now();

  -- Audita si cambió algo.
  if (v_p is distinct from coalesce(p_participa,true)) or (v_e is distinct from coalesce(p_es_chofer,false)) or v_p is null then
    insert into sgc.incentivo_participante_audit (conductor_id, usuario_id, participa, es_chofer, motivo, cambiado_por)
    values ((select id from sgc.conductores c where c.usuario_id = p_usuario_id limit 1),
            p_usuario_id, coalesce(p_participa,true), coalesce(p_es_chofer,false), nullif(trim(p_motivo),''), auth.uid());
  end if;
end;
$function$;
grant execute on function sgc.set_incentivo_participante(uuid,boolean,boolean,text) to authenticated, service_role;

-- Compat: el setter viejo por conductor ahora escribe en el padrón (preserva es_chofer).
create or replace function sgc.set_participa_incentivo(p_conductor_id uuid, p_participa boolean, p_motivo text default null)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_usuario_id uuid; v_es_chofer boolean;
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_incentivos()) then
    raise exception 'No tienes permiso para cambiar la participación en el incentivo.';
  end if;
  select usuario_id into v_usuario_id from sgc.conductores where id = p_conductor_id;
  if v_usuario_id is null then raise exception 'Conductor no encontrado.'; end if;
  v_es_chofer := coalesce((select es_chofer from sgc.incentivo_participante where usuario_id = v_usuario_id),
                          exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                                  where ur.usuario_id = v_usuario_id and r.codigo = 'chofer_transportista'));
  perform sgc.set_incentivo_participante(v_usuario_id, p_participa, v_es_chofer, p_motivo);
end;
$function$;
grant execute on function sgc.set_participa_incentivo(uuid,boolean,text) to authenticated, service_role;

-- ── 3) es_chofer() del usuario actual: padrón OR rol (transición segura) ─────
create or replace function sgc.es_chofer()
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (select 1 from sgc.incentivo_participante ip
                 where ip.usuario_id = auth.uid() and ip.es_chofer)
      or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'chofer_transportista');
$function$;

-- ── 4) Lista del padrón (fuente = incentivo_participante, no conductores) ────
drop function if exists sgc.incentivo_participantes();
create or replace function sgc.incentivo_participantes()
returns table(conductor_id uuid, usuario_id uuid, nombre text, participa boolean,
              es_prueba boolean, es_chofer boolean, ultimo_cambio_en timestamptz,
              ultimo_cambio_por text, ultimo_motivo text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select (select id from sgc.conductores c where c.usuario_id = ip.usuario_id limit 1) as conductor_id,
         ip.usuario_id, u.nombre,
         ip.participa, coalesce(u.es_prueba, false) as es_prueba, ip.es_chofer,
         a.cambiado_en, au.nombre, a.motivo
    from sgc.incentivo_participante ip
    join sgc.usuarios u on u.id = ip.usuario_id
    left join lateral (
      select cambiado_en, cambiado_por, motivo from sgc.incentivo_participante_audit x
       where x.usuario_id = ip.usuario_id order by x.cambiado_en desc limit 1
    ) a on true
    left join sgc.usuarios au on au.id = a.cambiado_por
   where (sgc.is_admin() or sgc.puede_gestionar_incentivos())
   order by u.nombre;
$function$;
grant execute on function sgc.incentivo_participantes() to authenticated, service_role;

-- Directorio de candidatos para "Agregar persona" (usuarios que NO están aún en el padrón).
create or replace function sgc.incentivo_candidatos()
returns table(usuario_id uuid, nombre text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre from sgc.usuarios u
   where (sgc.is_admin() or sgc.puede_gestionar_incentivos())
     and coalesce(u.activo, true)
     and not exists (select 1 from sgc.incentivo_participante ip where ip.usuario_id = u.id)
   order by u.nombre;
$function$;
grant execute on function sgc.incentivo_candidatos() to authenticated, service_role;

-- ── 5) Lecturas: gate por el PADRÓN (es_chofer + participa), es_prueba igual ──
create or replace function sgc.incentivo_listado(p_anio integer, p_semana integer, p_incluir_prueba boolean default true)
returns table(informe_id uuid, usuario_id uuid, nombre text, conductor_id uuid, puntaje numeric,
              minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text, motivo text,
              decidido_por uuid, decidido_por_nombre text, decidido_en timestamptz)
language sql stable security definer set search_path to 'sgc', 'public'
as $function$
  select s.id, s.usuario_id, u.nombre, s.conductor_id,
         s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags,
         v.decision, v.motivo, v.decidido_por, du.nombre, v.decidido_en
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
    left join sgc.usuarios du on du.id = v.decidido_por
   where s.anio = p_anio and s.semana = p_semana
     and sgc.puede_gestionar_incentivos()
     and exists (select 1 from sgc.incentivo_participante ip
                 where ip.usuario_id = s.usuario_id and ip.es_chofer and coalesce(ip.participa, true))
     and (p_incluir_prueba
          or not exists (select 1 from sgc.conductores c
                         where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false)))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;

create or replace function sgc.incentivo_matriz_email(p_anio integer, p_semana integer)
returns table(nombre text, puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text)
language sql stable security definer set search_path to 'sgc', 'public'
as $function$
  select u.nombre, s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags, v.decision
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
   where s.anio = p_anio and s.semana = p_semana
     and exists (select 1 from sgc.incentivo_participante ip
                 where ip.usuario_id = s.usuario_id and ip.es_chofer and coalesce(ip.participa, true))
     and not exists (select 1 from sgc.conductores c
                     where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;

-- ── 6) Motor: la población final se gatea por el padrón (es_chofer) ──────────
--     (idéntico a bh3 salvo la última condición: rol → padrón).
create or replace function sgc.incentivo_generar_semana(p_anio integer, p_semana integer)
returns integer language plpgsql security definer set search_path to 'sgc', 'public'
as $function$
declare
  v_inicio date := sgc.incentivo_semana_inicio(p_anio, p_semana);
  v_fin    date := sgc.incentivo_semana_inicio(p_anio, p_semana) + 6;
  v_cfg    sgc.incentivo_config%rowtype;
  v_factor numeric;
  v_count  int := 0;
begin
  select * into v_cfg from sgc.incentivo_config where activo order by version desc limit 1;
  if not found then
    raise exception 'No hay configuración de incentivo activa' using errcode = 'AT404';
  end if;
  v_factor := coalesce(v_cfg.ayudante_factor, 1);

  with
  ruta_flag as (
    select r.id,
           coalesce(c.usuario_id, r.creado_por) as usuario_id,
           coalesce(d.decision, 'cuarentena') as decision
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
      left join sgc.incentivo_incidencia_decision d
             on d.anio = p_anio and d.semana = p_semana and d.ref_tipo = 'ruta' and d.ref_id = r.id
     where r.estado = 'completada' and not r.es_prueba
       and not coalesce(r.derivada_de_conduce, false)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha) between v_inicio and v_fin
       and (coalesce(r.km_real, 0) = 0 or coalesce(r.tiempo_real_min, 0) = 0)
       and coalesce(c.usuario_id, r.creado_por) is not null
  ),
  echada_flag as (
    select rc.id, rc.registrado_por as usuario_id,
           coalesce(d.decision, 'cuarentena') as decision
      from sgc.registros_combustible rc
      left join sgc.incentivo_incidencia_decision d
             on d.anio = p_anio and d.semana = p_semana and d.ref_tipo = 'echada' and d.ref_id = rc.id
     where not rc.es_prueba and rc.registrado_por is not null
       and not coalesce(rc.invalidada, false)
       and rc.fecha between v_inicio and v_fin
       and exists (
         select 1 from sgc.registros_combustible r2
          where r2.id <> rc.id and r2.registrado_por = rc.registrado_por
            and not coalesce(r2.invalidada, false)
            and date_trunc('minute', r2.created_at) = date_trunc('minute', rc.created_at))
  ),
  titulares as (
    select ck.creado_por as usuario_id, 'reporte_semanal'::text as renglon, ck.id as ref_id, ck.fecha as ref_fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia = 'semanal' and not ck.es_prueba and ck.creado_por is not null
       and ck.fecha between v_inicio and v_fin
    union all
    select ck.creado_por, 'inspeccion', ck.id, ck.fecha
      from sgc.checklists_vehiculo ck
      join sgc.checklist_plantillas pl on pl.id = ck.plantilla_id
     where pl.frecuencia <> 'semanal' and not ck.es_prueba and ck.creado_por is not null
       and ck.fecha between v_inicio and v_fin
    union all
    select rc.registrado_por, 'echada', rc.id, rc.fecha
      from sgc.registros_combustible rc
     where not rc.es_prueba and rc.registrado_por is not null
       and not coalesce(rc.invalidada, false)
       and coalesce(nullif(trim(rc.foto_tablero_path), ''), null) is not null
       and rc.fecha between v_inicio and v_fin
       and not exists (select 1 from echada_flag ef where ef.id = rc.id and ef.decision <> 'aceptada')
    union all
    select coalesce(c.usuario_id, r.creado_por), 'ruta', r.id, r.fecha
      from sgc.rutas r
      left join sgc.conductores c on c.id = r.conductor_id
     where r.estado = 'completada' and not r.es_prueba
       and not coalesce(r.derivada_de_conduce, false)
       and coalesce((r.finalizada_at at time zone 'America/Santo_Domingo')::date, r.fecha)
             between v_inicio and v_fin
       and coalesce(c.usuario_id, r.creado_por) is not null
       and not exists (select 1 from ruta_flag rf where rf.id = r.id and rf.decision <> 'aceptada')
    union all
    select coalesce(c.usuario_id, s.entregado_por), 'conduce', s.id, s.fecha
      from sgc.salidas_inventario s
      left join sgc.conductores c on c.id = s.conductor_id
     where s.recibido_por is not null and not s.es_prueba
       and coalesce((s.recibido_en at time zone 'America/Santo_Domingo')::date,
                    (s.entregado_en at time zone 'America/Santo_Domingo')::date, s.fecha)
             between v_inicio and v_fin
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
             * coalesce((v_cfg.pesos->>e.renglon)::numeric, 0) as puntos,
           jsonb_agg(jsonb_build_object('id', e.ref_id, 'tipo', e.renglon,
                     'fecha', e.ref_fecha, 'ayudante', e.es_ayudante)
                     order by e.ref_fecha) as refs
      from eventos e
     group by e.usuario_id, e.renglon
  ),
  agg as (
    select usuario_id,
           jsonb_object_agg(renglon, jsonb_build_object(
             'propio', propio, 'ayudante', ayudante, 'puntos', puntos, 'refs', refs)) as conteos,
           sum(puntos) as puntaje
      from por_renglon group by usuario_id
  ),
  flags_ruta as (
    select rf.usuario_id,
           jsonb_build_object('tipo','ruta_sin_metrica','ref_tipo','ruta','ref_id', rf.id,
             'fecha', r.fecha, 'decision', rf.decision,
             'msg','Ruta completada con 0 km o 0 min — revisar') as flag
      from ruta_flag rf join sgc.rutas r on r.id = rf.id
  ),
  flags_echada as (
    select ef.usuario_id,
           jsonb_build_object('tipo','echada_duplicada','ref_tipo','echada','ref_id', ef.id,
             'fecha', rc.fecha, 'decision', ef.decision,
             'msg','Echada registrada en el mismo minuto que otra — revisar') as flag
      from echada_flag ef join sgc.registros_combustible rc on rc.id = ef.id
  ),
  flags_all as (
    select usuario_id, jsonb_agg(flag) as flags
      from (select * from flags_ruta union all select * from flags_echada) f
     group by usuario_id
  ),
  poblacion as (
    select usuario_id from agg
    union
    select usuario_id from flags_all
  )
  insert into sgc.incentivo_semana as ins
    (anio, semana, inicio, fin, usuario_id, conductor_id, config_version, pesos, minimo,
     conteos, puntaje, cumplio, flags, generado_at)
  select p_anio, p_semana, v_inicio, v_fin, p.usuario_id,
         (select id from sgc.conductores c where c.usuario_id = p.usuario_id limit 1),
         v_cfg.version, v_cfg.pesos, v_cfg.minimo_semanal,
         coalesce(a.conteos, '{}'::jsonb), coalesce(a.puntaje, 0),
         (coalesce(a.puntaje, 0) >= v_cfg.minimo_semanal),
         coalesce(fa.flags, '[]'::jsonb), now()
    from poblacion p
    left join agg a on a.usuario_id = p.usuario_id
    left join flags_all fa on fa.usuario_id = p.usuario_id
   where exists (select 1 from sgc.incentivo_participante ip
                 where ip.usuario_id = p.usuario_id and ip.es_chofer)   -- BK3: padrón, no rol
  on conflict (anio, semana, usuario_id) do update
    set conteos = excluded.conteos, puntaje = excluded.puntaje, cumplio = excluded.cumplio,
        flags = excluded.flags, pesos = excluded.pesos, minimo = excluded.minimo,
        config_version = excluded.config_version, conductor_id = excluded.conductor_id,
        generado_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

commit;
