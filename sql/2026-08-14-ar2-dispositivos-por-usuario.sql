-- =============================================================================
-- AR2 — Estadísticas: dispositivos POR USUARIO (+ historial de dispositivos)
--
-- Hoy sólo existe el dispositivo ACTUAL por usuario (sgc.usuarios.plataforma /
-- plataforma_modelo, AP7) — sin historial ni versión de app. Este log aditivo
-- registra una fila por dispositivo DISTINTO que usa cada usuario (dedupe por
-- usuario+plataforma+modelo), con la versión de app y el último visto, para poder
-- pintar en Sistema > Estadísticas una tabla por usuario con su(s) dispositivo(s),
-- versión y último uso, más el historial de los últimos 5. Gating: es_tecnologia().
-- SGC padre: la app (csd-app) ya llama set_mi_plataforma; aquí sólo se amplía.
-- =============================================================================

begin;

-- 1) Log de dispositivos por usuario (una fila por dispositivo distinto).
create table if not exists sgc.usuario_dispositivos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  plataforma  text not null,                                    -- android | ios | ios-pwa | web
  modelo      text,                                             -- "iPhone 13", "SM-G991B"; null en web
  -- clave estable para deduplicar tratando null como '' (unique ignora nulls)
  modelo_key  text generated always as (coalesce(modelo, '')) stored,
  app_version text,                                             -- versión de app/web en el último reporte
  primer_uso  timestamptz not null default now(),
  visto_at    timestamptz not null default now(),
  usos        integer not null default 1,
  unique (usuario_id, plataforma, modelo_key)
);
comment on table sgc.usuario_dispositivos is
  'AR2 — dispositivos usados por cada usuario (una fila por dispositivo distinto: plataforma+modelo). Alimentado por set_mi_plataforma. Para Estadísticas (historial de dispositivos).';
create index if not exists idx_usuario_dispositivos_usuario
  on sgc.usuario_dispositivos(usuario_id, visto_at desc);

-- 2) set_mi_plataforma: además de la fila actual en usuarios, ahora registra la
--    versión de app y acumula el historial en usuario_dispositivos. Se amplía a
--    3 args (p_app_version opcional) — retrocompatible: PostgREST resuelve las
--    llamadas de 2 args contra el default. Se elimina la firma vieja para no dejar
--    dos overloads ambiguos.
drop function if exists sgc.set_mi_plataforma(text, text);

create or replace function sgc.set_mi_plataforma(
  p_plataforma  text,
  p_modelo      text default null,
  p_app_version text default null
)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_modelo text := nullif(trim(coalesce(p_modelo, '')), '');
  v_ver    text := nullif(trim(coalesce(p_app_version, '')), '');
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if p_plataforma is null or p_plataforma not in ('android','ios','ios-pwa','web') then
    raise exception 'Plataforma inválida: %', p_plataforma;
  end if;

  update sgc.usuarios
     set plataforma        = p_plataforma,
         plataforma_modelo = v_modelo,
         plataforma_at     = now()
   where id = v_uid;

  insert into sgc.usuario_dispositivos (usuario_id, plataforma, modelo, app_version)
  values (v_uid, p_plataforma, v_modelo, v_ver)
  on conflict (usuario_id, plataforma, modelo_key) do update
     set visto_at    = now(),
         usos        = sgc.usuario_dispositivos.usos + 1,
         app_version = coalesce(excluded.app_version, sgc.usuario_dispositivos.app_version);
end;
$$;
grant execute on function sgc.set_mi_plataforma(text, text, text) to authenticated;
comment on function sgc.set_mi_plataforma(text, text, text) is
  'AP7/AR2 — la app/web reporta plataforma+modelo+versión del usuario autenticado. Actualiza su fila de usuarios y acumula el historial en usuario_dispositivos.';

-- 3) Backfill: sembrar el historial con el dispositivo actual ya conocido (AP7).
insert into sgc.usuario_dispositivos (usuario_id, plataforma, modelo, primer_uso, visto_at)
select id, plataforma, plataforma_modelo, coalesce(plataforma_at, now()), coalesce(plataforma_at, now())
from sgc.usuarios
where plataforma is not null
on conflict (usuario_id, plataforma, modelo_key) do nothing;

-- 4) RPC: dispositivos por usuario (para Estadísticas). Gated es_tecnologia().
create or replace function sgc.dispositivos_por_usuario()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when not sgc.es_tecnologia() then '[]'::jsonb else (
    select coalesce(jsonb_agg(row order by (row->>'ultimo_uso') desc nulls last), '[]'::jsonb)
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
        'app_version', (select d.app_version from sgc.usuario_dispositivos d
                         where d.usuario_id = u.id and d.app_version is not null
                         order by d.visto_at desc limit 1),
        'ultimo_uso',  greatest(u.ultima_actividad_web, u.ultima_actividad_app, u.plataforma_at),
        'dispositivos_total', (select count(*) from sgc.usuario_dispositivos d where d.usuario_id = u.id),
        'historial',   coalesce((
                          select jsonb_agg(jsonb_build_object(
                                   'plataforma',  h.plataforma,
                                   'modelo',      h.modelo,
                                   'app_version', h.app_version,
                                   'visto_at',    h.visto_at,
                                   'usos',        h.usos) order by h.visto_at desc)
                          from (select * from sgc.usuario_dispositivos d2
                                 where d2.usuario_id = u.id
                                 order by d2.visto_at desc limit 5) h), '[]'::jsonb)
      ) as row
      from sgc.usuarios u
      where u.activo
    ) t
  ) end;
$$;
grant execute on function sgc.dispositivos_por_usuario() to authenticated, service_role;
comment on function sgc.dispositivos_por_usuario() is
  'AR2 — tabla por usuario para Estadísticas: dispositivo(s), versión de app, último uso e historial (5). Gated es_tecnologia().';

-- 5) RLS del log (lectura sólo tecnología/admin o el propio usuario; escritura vía RPC definer).
alter table sgc.usuario_dispositivos enable row level security;
drop policy if exists "usuario_dispositivos: lectura tec/propio" on sgc.usuario_dispositivos;
create policy "usuario_dispositivos: lectura tec/propio" on sgc.usuario_dispositivos
  for select to authenticated
  using (sgc.es_tecnologia() or usuario_id = auth.uid());
grant select on sgc.usuario_dispositivos to authenticated;

commit;
