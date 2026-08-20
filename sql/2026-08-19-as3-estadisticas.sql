-- =============================================================================
-- AS3 — Rediseño de "Sistema › Estadísticas" + fix del reporte de versión.
--
-- Aditivo e idempotente. NO cambia la firma de set_mi_plataforma (el fix de la
-- app va en PROMPT-2). Aquí sólo:
--   1) build_number en usuario_dispositivos (para futura 4-arg de la app).
--   2) helper semver_key() para comparar versiones ("1.86.0" < "1.90.0").
--   3) dispositivos_por_usuario() ahora expone last_seen_at + obsoleta (+ build).
--   4) estadisticas_uso() ahora expone versiones_ultimas (publicada por plataforma).
--
-- ROOT CAUSE del desfase de versión (documentado, se arregla en la app): el upsert
-- de set_mi_plataforma hace app_version = coalesce(excluded, existente), así que un
-- reporte con NULL nunca sobrescribe una versión vieja no-nula. La web ya reporta
-- SIEMPRE su APP_VERSION no-nula; la app debe hacer lo mismo en cada arranque.
-- =============================================================================

begin;

-- 1) build_number (aditivo). La app (PROMPT-2) lo mandará junto a app_version en una
--    4-arg set_mi_plataforma(p_plataforma, p_modelo, p_app_version, p_build_number).
--    NO se crea esa overload aquí para no tocar el contrato vigente.
alter table sgc.usuario_dispositivos
  add column if not exists build_number int;
comment on column sgc.usuario_dispositivos.build_number is
  'AS3 — número de build del cliente (opcional). Lo poblará la 4-arg de set_mi_plataforma (PROMPT-2).';

-- 2) Helper de comparación semver: "1.86.0" -> {1,86,0}. Los int[] se comparan
--    elemento a elemento, así que {1,86,0} < {1,90,0}. Nulo/vacío -> NULL.
create or replace function sgc.semver_key(p_version text)
returns int[]
language sql
immutable
as $$
  select array_agg(
           coalesce(nullif(regexp_replace(part, '[^0-9].*$', ''), ''), '0')::int
           order by ord)
    from unnest(string_to_array(nullif(btrim(coalesce(p_version, '')), ''), '.'))
         with ordinality as u(part, ord);
$$;
comment on function sgc.semver_key(text) is
  'AS3 — normaliza una versión "x.y.z" a int[] comparable (para detectar versión obsoleta).';

-- 3) dispositivos_por_usuario(): + last_seen_at (actividad + visto_at más reciente),
--    + obsoleta (app_version < última publicada de su plataforma; null = "sin dato",
--    NO obsoleta), + build_number. Retrocompatible (sólo agrega campos).
create or replace function sgc.dispositivos_por_usuario()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when not sgc.es_tecnologia() then '[]'::jsonb else (
    select coalesce(jsonb_agg(row order by (row->>'last_seen_at') desc nulls last), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'usuario_id',  u.id,
        'nombre',      u.nombre,
        'email',       u.email,
        'roles',       coalesce((select array_agg(r.nombre order by r.nombre)
                                   from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                                  where ur.usuario_id = u.id), array[]::text[]),
        'plataforma',  u.plataforma,
        'modelo',      u.plataforma_modelo,
        'app_version', dev.app_version,
        'build_number', dev.build_number,
        'ultimo_uso',  greatest(u.ultima_actividad_web, u.ultima_actividad_app, u.plataforma_at),
        'last_seen_at', greatest(u.ultima_actividad_web, u.ultima_actividad_app, u.plataforma_at, dev.visto_max),
        'dispositivos_total', dev.total,
        'obsoleta',    (case
                          when dev.app_version is null then false
                          else coalesce(sgc.semver_key(dev.app_version) < pub.key, false)
                        end),
        'historial',   coalesce((
                          select jsonb_agg(jsonb_build_object(
                                   'plataforma',  h.plataforma,
                                   'modelo',      h.modelo,
                                   'app_version', h.app_version,
                                   'build_number', h.build_number,
                                   'visto_at',    h.visto_at,
                                   'usos',        h.usos) order by h.visto_at desc)
                          from (select * from sgc.usuario_dispositivos d2
                                 where d2.usuario_id = u.id
                                 order by d2.visto_at desc limit 5) h), '[]'::jsonb)
      ) as row
      from sgc.usuarios u
      left join lateral (
        select
          (select d.app_version from sgc.usuario_dispositivos d
            where d.usuario_id = u.id and d.app_version is not null
            order by d.visto_at desc limit 1) as app_version,
          (select d.build_number from sgc.usuario_dispositivos d
            where d.usuario_id = u.id and d.build_number is not null
            order by d.visto_at desc limit 1) as build_number,
          (select count(*) from sgc.usuario_dispositivos d where d.usuario_id = u.id) as total,
          (select max(d.visto_at) from sgc.usuario_dispositivos d where d.usuario_id = u.id) as visto_max
      ) dev on true
      left join lateral (
        select sgc.semver_key(ver.version) as key
        from sgc.app_versiones ver
        where ver.publicada
          and ver.plataforma = case when u.plataforma = 'web' then 'web' else 'movil' end
        order by sgc.semver_key(ver.version) desc nulls last, ver.created_at desc
        limit 1
      ) pub on true
      where u.activo
    ) t
  ) end;
$$;
grant execute on function sgc.dispositivos_por_usuario() to authenticated, service_role;
comment on function sgc.dispositivos_por_usuario() is
  'AR2/AS3 — tabla por usuario para Estadísticas: dispositivo(s), versión de app, último uso, last_seen_at, obsoleta vs publicada e historial (5). Gated es_tecnologia().';

-- 4) estadisticas_uso(): + versiones_ultimas = versión publicada más alta por
--    plataforma del catálogo ('web'/'movil'). Sirve para resaltar la barra publicada
--    y para el KPI "% en la última versión". Sólo agrega un campo (retrocompatible).
create or replace function sgc.estadisticas_uso()
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $$
  select case when not sgc.es_tecnologia() then '{}'::jsonb else jsonb_build_object(
    'generado_at', now(),
    'total_usuarios', (select count(*) from sgc.usuarios where activo),
    'activos_dia',    (select count(*) from sgc.usuarios where activo
                        and (ultima_actividad_web > now() - interval '1 day'
                          or ultima_actividad_app > now() - interval '1 day')),
    'activos_semana', (select count(*) from sgc.usuarios where activo
                        and (ultima_actividad_web > now() - interval '7 day'
                          or ultima_actividad_app > now() - interval '7 day')),
    'activos_mes',    (select count(*) from sgc.usuarios where activo
                        and (ultima_actividad_web > now() - interval '30 day'
                          or ultima_actividad_app > now() - interval '30 day')),
    'web_semana',     (select count(*) from sgc.usuarios where activo and ultima_actividad_web > now() - interval '7 day'),
    'app_semana',     (select count(*) from sgc.usuarios where activo and ultima_actividad_app > now() - interval '7 day'),
    'dispositivos',   (select coalesce(jsonb_agg(jsonb_build_object(
                          'plataforma', coalesce(plataforma, '(sin reportar)'), 'total', c) order by c desc), '[]'::jsonb)
                        from (select plataforma, count(*) c from sgc.usuarios where activo group by plataforma) t),
    'app_android_tokens', (select count(distinct usuario_id) from sgc.device_tokens where activo and plataforma = 'android'),
    'versiones', (select coalesce(jsonb_agg(jsonb_build_object(
                     'plataforma', plataforma, 'version', version, 'publicada', publicada, 'fecha', fecha) order by created_at desc), '[]'::jsonb)
                   from (select plataforma, version, publicada, fecha, created_at
                         from sgc.app_versiones order by created_at desc limit 12) v),
    'versiones_ultimas', coalesce((
                   select jsonb_object_agg(plataforma, version)
                   from (select distinct on (plataforma) plataforma, version
                           from sgc.app_versiones
                          where publicada
                          order by plataforma, sgc.semver_key(version) desc nulls last, created_at desc) u
                 ), '{}'::jsonb)
  ) end;
$$;
grant execute on function sgc.estadisticas_uso() to authenticated, service_role;

commit;
