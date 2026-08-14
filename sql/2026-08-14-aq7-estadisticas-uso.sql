-- AQ7 — Sistema > "Estadísticas": uso de web y app + dispositivos + versiones
--
-- Fuentes (sin tablas nuevas): usuarios.ultima_actividad_web/app (W12) para
-- usuarios activos D/S/M y el split web-vs-app; usuarios.plataforma (AP7) para la
-- distribución de dispositivos; device_tokens para app instaladas; app_versiones
-- para el catálogo de versiones. Gating: es_tecnologia() (admin o módulo tecnología).
--
-- Nota: ultima_actividad_* es un "último visto" (una marca por canal), así que da
-- activos D/S/M y split de canal, NO curvas históricas ni conteo de sesiones (eso
-- requeriría un log append-only; queda como mejora futura).

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
                         from sgc.app_versiones order by created_at desc limit 12) v)
  ) end;
$$;
grant execute on function sgc.estadisticas_uso() to authenticated, service_role;
