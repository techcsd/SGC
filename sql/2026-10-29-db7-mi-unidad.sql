-- sql/2026-10-29-db7-mi-unidad.sql — Ronda DB (PROMPT-124 F1, DB12 — chofer Joan)
-- Diagnóstico F0 (29-oct, prod, solo SELECT):
--   · Joan tiene asignación ACTIVA de L542136 (origen 'auto', 21-ago) y es su
--     responsable, pero el cron `sgc-cerrar-usos-huerfanos` le cerró el uso el
--     20-oct («Cerrado automaticamente: uso sin cierre > 24 h») — eso es «la app
--     me suelta la unidad»: el cron cierra TODO uso > 24 h sin mirar asignación.
--   · Además la flota quedó casi completa en estado `no_disponible` el 28-oct
--     (los seguros SURA vencieron ese día → trigger act3-p9), y el pool de la app
--     filtra `no_disponible` → Joan solo ve 2 unidades. Eso se corrige subiendo
--     los seguros renovados (lector DB3), NO por SQL (DB-07).
--
-- Tres piezas ADITIVAS:
--   1) parámetro `uso_vehiculo_max_dias_asignado` (default 7)
--   2) `cerrar_usos_huerfanos`: no cierra a las 24 h un uso cuyo usuario tiene
--      asignación ACTIVA del mismo vehículo; aun así lo cierra al pasar el tope
--      de días (un cron que nunca suelta deja el vehículo «en uso» para siempre).
--   3) RPC `mi_unidad()`: la unidad del usuario (su uso abierto, o su asignación
--      activa) con `en_uso_por` (si otro la tiene) y `visible` (si el pool de la
--      app la mostraría) — base de la tarjeta «Mi unidad» (app, PROMPT-125 A2).
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db7-mi-unidad.sql --env dev

-- ── 1) Parámetro ──────────────────────────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('uso_vehiculo_max_dias_asignado', '7',
   'Días que un uso abierto puede vivir cuando el chofer tiene ASIGNACIÓN activa del vehículo. Pasado el tope, el cron lo cierra igual (con aviso). Sin asignación, el cierre sigue siendo a las 24 h.')
on conflict (clave) do nothing;

-- ── 2) cerrar_usos_huerfanos respeta la asignación activa ─────────────────────
create or replace function sgc.cerrar_usos_huerfanos(p_horas integer default 24)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  r record;
  n int := 0;
  -- DB12 — tope de días para un uso CON asignación activa (default 7, parámetro).
  v_max_dias int := greatest(1, coalesce(
    (select case when valor ~ '^\d+$' then valor::int end
       from sgc.parametros where clave = 'uso_vehiculo_max_dias_asignado'), 7));
begin
  for r in
    select vu.id, vu.usuario_id, vu.vehiculo_id, v.placa
    from sgc.vehiculo_usos vu
    left join sgc.vehiculos v on v.id = vu.vehiculo_id
    where vu.fin_at is null
      and coalesce(vu.es_prueba,false) = false
      and vu.inicio_at < now() - make_interval(hours => greatest(1, p_horas))
      and (
        -- DB12 — la unidad asignada no se «suelta» a las 24 h (el caso de Joan:
        -- chofer con unidad fija perdía su vehículo cada madrugada)…
        not exists (
          select 1 from sgc.vehiculo_asignaciones va
          where va.usuario_id = vu.usuario_id
            and va.vehiculo_id = vu.vehiculo_id
            and va.activa)
        -- …pero tampoco vive para siempre: tope en días con aviso igual.
        or vu.inicio_at < now() - make_interval(days => v_max_dias)
      )
  loop
    update sgc.vehiculo_usos
       set fin_at = now(),
           notas  = concat_ws(' · ', notas, 'Cerrado automaticamente: uso sin cierre > ' || p_horas || ' h')
     where id = r.id;
    if r.usuario_id is not null then
      perform sgc.notificar_usuarios(
        array[r.usuario_id], 'flota_uso_cerrado',
        'Uso de vehiculo cerrado', 'Cerramos tu uso de ' || coalesce(r.placa,'un vehiculo') ||
        ' porque quedo abierto mas de ' || p_horas || ' horas. Si lo sigues usando, abrelo de nuevo.',
        '/flota/mi-vehiculo', r.vehiculo_id, 'vehiculo_uso');
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

-- ── 3) mi_unidad() — la unidad del usuario, honesta sobre su estado ───────────
-- Prioridad: (1) mi uso abierto; (2) mi asignación activa más reciente.
-- `visible` replica el filtro del pool de la app (activo + visible_choferes +
-- estado fuera de baja/no_disponible): si es false, la tarjeta «Mi unidad» explica
-- por qué no aparece en el selector en vez de callar (regla 16 / AT11).
create or replace function sgc.mi_unidad()
returns table(
  vehiculo_id uuid,
  placa text,
  alias text,
  marca text,
  modelo text,
  estado text,
  visible boolean,
  origen text,                -- 'uso' (lo tengo en uso) | 'asignacion'
  asignacion_desde timestamptz,
  en_uso_por uuid,            -- quién lo tiene AHORA (null = nadie)
  en_uso_por_nombre text,
  en_uso_por_mi boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with candidata as (
    -- (1) mi uso abierto
    select vu.vehiculo_id, 'uso'::text as origen, null::timestamptz as asignacion_desde,
           1 as prioridad, vu.inicio_at as orden
    from sgc.vehiculo_usos vu
    where vu.usuario_id = auth.uid() and vu.fin_at is null
    union all
    -- (2) mi asignación activa
    select va.vehiculo_id, 'asignacion', va.desde, 2, va.desde
    from sgc.vehiculo_asignaciones va
    where va.usuario_id = auth.uid() and va.activa
  ),
  elegida as (
    select * from candidata order by prioridad, orden desc limit 1
  )
  select v.id, v.placa, v.alias, v.marca, v.modelo, v.estado,
         (coalesce(v.activo,false)
          and coalesce(v.visible_choferes,false)
          and coalesce(v.estado,'activo') not in ('baja','no_disponible')) as visible,
         e.origen, e.asignacion_desde,
         uso.usuario_id as en_uso_por,
         uso_u.nombre as en_uso_por_nombre,
         (uso.usuario_id = auth.uid()) as en_uso_por_mi
  from elegida e
  join sgc.vehiculos v on v.id = e.vehiculo_id
  left join lateral (
    select vu.usuario_id from sgc.vehiculo_usos vu
    where vu.vehiculo_id = v.id and vu.fin_at is null
    order by vu.inicio_at desc limit 1
  ) uso on true
  left join sgc.usuarios uso_u on uso_u.id = uso.usuario_id;
$function$;
grant execute on function sgc.mi_unidad() to authenticated, service_role;
