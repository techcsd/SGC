-- ============================================================================
-- Mejoras 14/07/2026 — Proyectos (R25 % pagado vs % trabajado + alerta)
-- ----------------------------------------------------------------------------
-- Aditivo. No existe fuente de pagos en el sistema -> se agrega un
-- porcentaje_pagado editable (Dirección/Admin). El % trabajado (avance físico)
-- sale de las partidas (R24) si existen; si no, del promedio de fases.
--   1. proyectos.porcentaje_pagado
--   2. vista sgc.v_proyecto_avance (avance físico + pago + bandera pago_excede)
--   3. tabla sgc.avisos_proyecto (patrón avisos_flota) + RPCs
-- ============================================================================

set search_path = sgc, public;

alter table sgc.proyectos
  add column if not exists porcentaje_pagado numeric;
do $$ begin
  alter table sgc.proyectos
    add constraint proyectos_pct_pagado_chk
    check (porcentaje_pagado is null or (porcentaje_pagado >= 0 and porcentaje_pagado <= 100));
exception when duplicate_object then null; end $$;

-- ── Vista de avance (físico vs pagado) ──────────────────────────────────────
create or replace view sgc.v_proyecto_avance
with (security_invoker = true) as
select
  p.id as proyecto_id,
  p.codigo,
  p.nombre,
  p.porcentaje_pagado,
  coalesce(
    (select case when sum(cantidad_planeada) > 0
              then least(100, round(100.0 * sum(least(cantidad_ejecutada, cantidad_planeada)) / sum(cantidad_planeada)))
              else null end
       from sgc.proyecto_partidas pp
      where pp.proyecto_id = p.id and pp.activa),
    (select round(avg(progreso)) from sgc.fases_proyecto f where f.proyecto_id = p.id),
    0
  )::numeric as avance_trabajado,
  (select count(*) from sgc.proyecto_partidas pp where pp.proyecto_id = p.id and pp.activa) as n_partidas,
  (p.porcentaje_pagado is not null
     and p.porcentaje_pagado > coalesce(
       (select case when sum(cantidad_planeada) > 0
                 then least(100, round(100.0 * sum(least(cantidad_ejecutada, cantidad_planeada)) / sum(cantidad_planeada)))
                 else null end
          from sgc.proyecto_partidas pp where pp.proyecto_id = p.id and pp.activa),
       (select round(avg(progreso)) from sgc.fases_proyecto f where f.proyecto_id = p.id),
       0)
  ) as pago_excede
from sgc.proyectos p
where coalesce(p.activo, true);
grant select on sgc.v_proyecto_avance to authenticated, service_role;

-- ── Avisos de proyecto (patrón avisos_flota) ────────────────────────────────
create table if not exists sgc.avisos_proyecto (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null default 'pago_mayor_trabajo',
  proyecto_id   uuid references sgc.proyectos(id) on delete cascade,
  referencia_id uuid,
  mensaje       text not null,
  severidad     text not null default 'media',
  estado        text not null default 'pendiente',
  dedup_key     text,
  atendido_por  uuid references sgc.usuarios(id),
  atendido_at   timestamptz,
  nota_atencion text,
  created_at    timestamptz not null default now(),
  constraint avisos_proyecto_tipo_chk check (tipo in ('pago_mayor_trabajo')),
  constraint avisos_proyecto_estado_chk check (estado in ('pendiente','atendido')),
  constraint avisos_proyecto_sev_chk    check (severidad in ('baja','media','alta'))
);
create unique index if not exists uq_avisos_proyecto_dedup
  on sgc.avisos_proyecto(dedup_key) where dedup_key is not null;
create index if not exists idx_avisos_proyecto_estado on sgc.avisos_proyecto(estado);
create index if not exists idx_avisos_proyecto_proy   on sgc.avisos_proyecto(proyecto_id);

alter table sgc.avisos_proyecto enable row level security;
drop policy if exists avisos_proyecto_sel on sgc.avisos_proyecto;
create policy avisos_proyecto_sel on sgc.avisos_proyecto for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion'));
drop policy if exists avisos_proyecto_all on sgc.avisos_proyecto;
create policy avisos_proyecto_all on sgc.avisos_proyecto for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion'));

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.avisos_proyecto to authenticated;
grant all on sgc.avisos_proyecto to service_role;

do $$ begin
  alter publication supabase_realtime add table sgc.avisos_proyecto;
exception when duplicate_object then null; end $$;

-- RPC: genera avisos de "pagado > trabajado" (idempotente por proyecto y día).
-- Se llama al cargar el panel/dashboard (patrón generarVencimientos de flota).
create or replace function sgc.evaluar_avisos_proyecto()
returns int
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No autorizado';
  end if;

  with nuevos as (
    insert into sgc.avisos_proyecto (tipo, proyecto_id, mensaje, severidad, dedup_key)
    select 'pago_mayor_trabajo', a.proyecto_id,
           format('El proyecto %s está pagado al %s%% pero sólo trabajado al %s%%. Revisar: no se debe pagar más de lo ejecutado.',
                  a.nombre, a.porcentaje_pagado, a.avance_trabajado),
           'alta',
           'pago_mayor_trabajo:' || a.proyecto_id || ':' || current_date
      from sgc.v_proyecto_avance a
     where a.pago_excede
    on conflict (dedup_key) do nothing
    returning 1
  )
  select count(*) into v_n from nuevos;

  if v_n > 0 then
    perform sgc.notificar_modulo('direccion', 'warning',
      'Pago mayor al avance de obra',
      format('%s proyecto(s) con %% pagado por encima del %% trabajado.', v_n),
      '/proyectos');
  end if;
  return v_n;
end;
$$;
grant execute on function sgc.evaluar_avisos_proyecto() to authenticated, service_role;

create or replace function sgc.atender_aviso_proyecto(p_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No autorizado';
  end if;
  update sgc.avisos_proyecto
     set estado = 'atendido', atendido_por = auth.uid(), atendido_at = now(),
         nota_atencion = nullif(p_nota,'')
   where id = p_id;
end;
$$;
grant execute on function sgc.atender_aviso_proyecto(uuid, text) to authenticated, service_role;
