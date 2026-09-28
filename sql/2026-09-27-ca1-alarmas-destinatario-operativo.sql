-- ════════════════════════════════════════════════════════════════════════════
-- CA1 — Las alarmas de chofer no deben llegarle a un no-operativo (Eduardo, Gerente).
-- Nota #81: "Eduardo still having the weekly vehicle inspection alert, but supposedly i
-- turned off her alert. because he as an Gerente, dont need to have an active alert that
-- persist. lets turn it off, and remember we did something about it…"
-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO CON DATOS (prod, SELECT — 28/09):
--   • La alarma de INSPECCIÓN ya está apagada para Eduardo: hay una `notif_regla`
--     de usuario (habilitado=false) → notif_permitida('alarm-weekly-inspection')=false.
--     Eso lo apagó Xaviel antes (BQ2). Eduardo NUNCA recibió esa alarma (0 filas en
--     `notificaciones`). La de REPORTE no tiene regla → notif_permitida=true.
--   • LO QUE SÍ le llega (y es lo que él llama "alerta que persiste"): los recordatorios
--     de estado de chofer de AV6 (`recordar_estados_chofer`): "Actualiza tu estado" (×28)
--     y "Chofer mucho tiempo disponible" (×178). Causa: Eduardo tiene una FICHA de
--     conductor + un `chofer_estado='disponible'` atascado desde 2026-08-10, y `gerencia`
--     lo hace flota-elevado → se le avisa como chofer Y sobre sí mismo. Un Gerente jamás
--     debería ser tratado como chofer.
--   • Hipótesis del CONTEXTO §A CA1: la #1 (lo tratan como chofer por el vínculo con el
--     vehículo) es la correcta EN ESPÍRITU, pero el vínculo real no es `responsable_id`
--     sino la ficha `conductores` + asignación; y el emisor vivo no es la alarma semanal
--     sino AV6.
--
-- FIX (regla 7 — destinatario correcto, no parche por usuario):
--   (a) `es_usuario_operativo_flota(u)` ROL-primario: un chofer real tiene un ROL operativo
--       (es_operativo / chofer_transportista / jefe_flota). La ficha `conductores` SOLA no
--       basta si el usuario tiene un rol de oficina/gerencia (Eduardo, Felipe=dirección,
--       Test User 3, Xaviel tienen ficha pero son oficina → NO son choferes).
--   (b) Los emisores de chofer (alarmas semanales + AV6 recordatorios de estado) solo
--       apuntan a operativos → Eduardo deja de recibir.
--   (c) La Matriz gana "Silenciada para": `set_notif_pref_de(u,tipo,activa)` (gate admin)
--       escribe la pref de OTRO (registrando `definida_por`); `notif_permitida` la respeta
--       aunque el usuario no pueda silenciarse solo. Fuente ÚNICA = `notif_pref_usuario`
--       (con `definida_por`), no una 2ª columna en notif_tipo (regla 14).
--   (d) Eduardo silenciado en ambas alarmas por seed (belt-and-suspenders + visible en la
--       Matriz), definida_por = Xaviel.
--
-- ADITIVO / retrocompatible. Rollback: notif_permitida/destinatarios_notificacion/
--   recordatorio_reporte_semanal/recordar_estados_chofer vuelven a su versión anterior;
--   `silenciada` de Eduardo a null; drop es_usuario_operativo_flota/set_notif_pref_de/
--   notif_silenciada_para; `definida_por` a null.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-27-ca1-alarmas-destinatario-operativo.sql --env dev  →  --env prod --yes
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local search_path = sgc, public;

-- ── 1) ¿Es el usuario un operativo de flota (chofer real)? ────────────────────
-- ROL-primario. La ficha `conductores` cuenta SOLO si el usuario no tiene ningún rol de
-- oficina (un rol NO operativo). Así un chofer puro (ficha, sin roles / solo operativos)
-- entra, pero un Gerente/Ingeniero/Dirección con ficha suelta NO.
create or replace function sgc.es_usuario_operativo_flota(p_usuario uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p_usuario is not null and (
    -- Rol operativo explícito → chofer real.
    exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = p_usuario
        and (coalesce(r.es_operativo, false) or r.codigo in ('chofer_transportista','jefe_flota'))
    )
    -- O ficha de conductor activa Y SIN ningún rol de oficina (no operativo).
    or (
      exists (select 1 from sgc.conductores c
              where c.usuario_id = p_usuario and coalesce(c.activo, true))
      and not exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = p_usuario
          and not (coalesce(r.es_operativo, false) or r.codigo in ('chofer_transportista','jefe_flota'))
      )
    )
  );
$$;
grant execute on function sgc.es_usuario_operativo_flota(uuid) to authenticated, service_role;
comment on function sgc.es_usuario_operativo_flota(uuid) is
  'CA1 — ¿el usuario es un operativo de flota (chofer real)? Rol-primario: rol es_operativo '
  '/ chofer_transportista / jefe_flota; o ficha conductores activa SIN rol de oficina. Los '
  'destinatarios de alarmas/recordatorios de chofer se restringen a estos (un Gerente con '
  'ficha suelta no es chofer).';

-- ── 2) notif_pref_usuario: quién definió la preferencia (self vs admin) ───────
alter table sgc.notif_pref_usuario
  add column if not exists definida_por uuid null references sgc.usuarios(id);
comment on column sgc.notif_pref_usuario.definida_por is
  'CA1 — quién fijó esta preferencia. null = el propio usuario. Un admin puede silenciar a '
  'otro (set_notif_pref_de); notif_permitida respeta ese silencio aunque el usuario no pueda '
  'silenciarse solo.';

-- ── 3) notif_permitida: respeta el silencio fijado por un admin ───────────────
-- Antes (BT6): el silencio contaba solo si el usuario PODÍA silenciar (puede_silenciar_notif).
-- Ahora: cuenta también si lo fijó un admin (definida_por is not null). Así "lo que apagaste
-- en la Matriz" queda apagado de verdad aunque el usuario no tenga el switch.
create or replace function sgc.notif_permitida(p_usuario uuid, p_tipo text)
 returns boolean
 language sql stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select case
    when p_tipo is null then true
    else coalesce(sgc.notif_regla_habilitado(p_usuario, p_tipo), true)
         and not exists (
           select 1 from sgc.notif_pref_usuario np
           where np.usuario_id = p_usuario and np.tipo = p_tipo and np.silenciado
             and (np.definida_por is not null or sgc.puede_silenciar_notif(p_usuario, p_tipo))
         )
  end
$function$;

-- ── 4) destinatarios_notificacion: mismo respeto al admin + exclusión de no-operativos ──
-- (para los dos tipos de alarma de chofer). Los demás tipos no cambian.
create or replace function sgc.destinatarios_notificacion(p_tipo text, p_modulo text default null, p_usuarios uuid[] default null, p_canal text default 'email')
 returns table(usuario_id uuid, email text, nombre text, excluido_por text)
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  return query
  with base as (
    select distinct u.id, u.email::text as email, u.nombre::text as nombre
    from sgc.usuarios u
    where u.activo
      and (
        (p_usuarios is not null and u.id = any(p_usuarios))
        or (p_usuarios is null and p_modulo is not null and exists (
              select 1 from sgc.usuarios_roles ur
              join sgc.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id
                and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos))))
      )
  ),
  reglas as (
    select b.id,
           (select case
                     when nr.usuario_id is not null then 'regla_usuario'
                     when nr.rol is not null        then 'regla_rol'
                     else 'regla_global'
                   end
              from sgc.notif_regla nr
             where nr.tipo = p_tipo
               and (
                 nr.usuario_id = b.id
                 or (nr.usuario_id is null and nr.rol is null)
                 or (nr.usuario_id is null and nr.rol is not null and exists (
                       select 1 from sgc.usuarios_roles ur
                       join sgc.roles ro on ro.id = ur.rol_id
                       where ur.usuario_id = b.id and ro.codigo = nr.rol))
               )
               and nr.habilitado = false
             order by (nr.usuario_id is not null) desc, (nr.rol is not null) desc
             limit 1) as regla_bloquea
    from base b
  )
  select b.id, b.email, b.nombre,
         case
           when coalesce(sgc.notif_regla_habilitado(b.id, p_tipo), true) = false
             then coalesce(r.regla_bloquea, 'regla_global')
           -- CA1: las alarmas de chofer solo a operativos de flota.
           when p_tipo in ('alarm-weekly-inspection','alarma-reporte-semanal')
                and not sgc.es_usuario_operativo_flota(b.id)
             then 'no_operativo'
           -- El silencio del usuario cuenta si PUEDE silenciar o si lo fijó un admin.
           when exists (
                  select 1 from sgc.notif_pref_usuario np
                  where np.usuario_id = b.id and np.tipo = p_tipo and np.silenciado
                    and (np.definida_por is not null or sgc.puede_silenciar_notif(b.id, p_tipo)))
             then 'pref_usuario'
           else null
         end as excluido_por
  from base b
  left join reglas r on r.id = b.id;
end;
$function$;

-- ── 5) set_notif_pref_de: el admin fija la preferencia de OTRO usuario ────────
-- p_activa=true → notificación activa (silenciado=false); p_activa=false → silenciada.
create or replace function sgc.set_notif_pref_de(p_usuario uuid, p_tipo text, p_activa boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_usuario is null or p_tipo is null then
    raise exception 'Faltan datos (usuario/tipo)' using errcode = '22023';
  end if;
  insert into sgc.notif_pref_usuario (usuario_id, tipo, silenciado, definida_por, updated_at)
  values (p_usuario, p_tipo, not coalesce(p_activa, true), auth.uid(), now())
  on conflict (usuario_id, tipo) do update
    set silenciado = excluded.silenciado, definida_por = excluded.definida_por, updated_at = now();
end;
$$;
grant execute on function sgc.set_notif_pref_de(uuid, text, boolean) to authenticated, service_role;
comment on function sgc.set_notif_pref_de(uuid, text, boolean) is
  'CA1 — el admin fija (activa/silencia) la preferencia de notificación de OTRO usuario, '
  'registrando definida_por. Backing de la columna "Silenciada para" de la Matriz.';

-- ── 6) notif_silenciada_para: a quién le silenció el admin este tipo (Matriz) ─
create or replace function sgc.notif_silenciada_para(p_tipo text)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when not sgc.is_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre)
                     order by u.nombre)
    from sgc.notif_pref_usuario np
    join sgc.usuarios u on u.id = np.usuario_id
    where np.tipo = p_tipo and np.silenciado and np.definida_por is not null
  ), '[]'::jsonb) end;
$$;
grant execute on function sgc.notif_silenciada_para(text) to authenticated, service_role;

-- ── 7) mis_notif_operativas: añade silenciada_por_admin (contrato app PROMPT-71 F2) ──
create or replace function sgc.mis_notif_operativas()
 returns jsonb
 language sql stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'tipo',        nt.tipo,
      'etiqueta',    nt.etiqueta,
      'descripcion', nt.descripcion,
      'silenciable', sgc.puede_silenciar_notif(auth.uid(), nt.tipo),
      'activa',      sgc.notif_permitida(auth.uid(), nt.tipo),
      'silenciada_por_admin', exists (
        select 1 from sgc.notif_pref_usuario np
        where np.usuario_id = auth.uid() and np.tipo = nt.tipo
          and np.silenciado and np.definida_por is not null and np.definida_por <> auth.uid())
    ) order by nt.orden nulls last, nt.etiqueta), '[]'::jsonb)
  from sgc.notif_tipo nt
  where coalesce(nt.activo, true) and coalesce(nt.es_operativa, false);
$function$;

-- ── 8) Emisor de la alarma semanal: excluye a no-operativos (belt) ────────────
create or replace function sgc.recordatorio_reporte_semanal(p_alarma boolean default false)
 returns integer
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_anio   int := extract(isoyear from (now() at time zone 'America/Santo_Domingo'))::int;
  v_semana int := extract(week   from (now() at time zone 'America/Santo_Domingo'))::int;
  v_ini_semana timestamptz := date_trunc('week', (now() at time zone 'America/Santo_Domingo')) at time zone 'America/Santo_Domingo';
  r record;
  v_n int := 0;
begin
  for r in
    select c.vehiculo_id, c.placa,
      coalesce(
        c.chofer_usuario_id,
        (select vu.usuario_id from sgc.vehiculo_usos vu
          where vu.vehiculo_id = c.vehiculo_id and vu.inicio_at >= v_ini_semana
          order by vu.inicio_at desc limit 1)
      ) as usuario_id
    from sgc.v_reporte_semanal_cumplimiento c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    where c.anio = v_anio and c.semana = v_semana
      and not coalesce(c.tiene_reporte, false)
      and not coalesce(v.es_prueba, false)
  loop
    if r.usuario_id is null then continue; end if;
    -- CA1: la alarma de chofer solo va a operativos de flota (un Gerente con vínculo
    -- accidental al vehículo no es chofer). Belt sobre notif_permitida.
    if not sgc.es_usuario_operativo_flota(r.usuario_id) then continue; end if;
    if not sgc.notif_permitida(r.usuario_id, 'alarm-weekly-inspection') then continue; end if;

    perform sgc.notificar(
      r.usuario_id, 'warning',
      case when p_alarma then '⏰ Inspección de tu vehículo' else 'Inspección de vehículo pendiente' end,
      format('%s Envía la inspección de %s desde la app.',
             case when p_alarma then 'Hazla ahora:' else 'Aún no la has enviado.' end,
             coalesce(r.placa, 'tu vehículo')),
      '/flota/reporte-semanal'
    );

    if p_alarma then
      perform sgc.send_push(
        array[r.usuario_id],
        'Inspección de tu vehículo',
        format('Haz ahora la inspección de %s. Sonará hasta que la completes.', coalesce(r.placa, 'tu vehículo')),
        jsonb_build_object(
          'tipo', 'alarm-weekly-inspection',
          'legacy_tipo', 'alarma-reporte-semanal',
          'ruta', '/flota/reporte-semanal',
          'alarma', true,
          'prioridad', 'alta',
          'channel_id', 'alarma_inspeccion',
          'vehiculo_id', r.vehiculo_id)
      );
    end if;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- ── 9) AV6 recordatorios de estado de chofer: solo a operativos (el emisor real) ──
-- Es lo que de verdad le llega a Eduardo ("Actualiza tu estado" / "Chofer mucho tiempo
-- disponible") por su ficha + estado atascado. Un no-operativo deja de ser candidato.
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
      and sgc.es_usuario_operativo_flota(c.usuario_id)   -- CA1: solo choferes reales
      and e.estado in ('inactivo','disponible')
  loop
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

-- ── 10) Seed DEFAULT: Eduardo silenciado en ambas alarmas (definida_por = Xaviel) ──
-- Ids estables entre dev y prod (clon por introspección). No-op si el usuario no existe.
with ed as (select id from sgc.usuarios where id = '2725c827-aec2-4e0c-90ac-dea1ee2b2350'::uuid),
     xa as (select id from sgc.usuarios where id = '4b19cc4b-3dbe-40dc-8631-ef489cad0f45'::uuid)
insert into sgc.notif_pref_usuario (usuario_id, tipo, silenciado, definida_por, updated_at)
select ed.id, t.tipo, true, (select id from xa), now()
from ed cross join (values ('alarm-weekly-inspection'), ('alarma-reporte-semanal')) t(tipo)
on conflict (usuario_id, tipo) do update
  set silenciado = true, definida_por = excluded.definida_por, updated_at = now();

commit;
