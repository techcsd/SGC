-- =============================================================================
-- PROMPT-7 FASE 3 (AV3) — Una obra puede tener VARIOS ingenieros responsables.
-- Ronda 24/08/2026 (IDs AV). Aditivo, idempotente, retrocompatible.
--
-- Estado previo: la N:M `sgc.proyecto_responsables` YA existe (Z2, 2026-07-26) con
-- tipo_responsabilidad ('residente'|'responsable') y RPCs. Lo que falta es la figura
-- de "PRINCIPAL" (para encabezados tipo "ENC. OBRA" y reportes que esperan uno) y
-- que los lectores singulares (`proyectos.responsable_id`) sigan cuadrando.
--
-- Diseño (decisión Xaviel: principal + adjuntos, MISMOS permisos):
--   • `proyecto_responsables` = fuente de verdad del equipo (principal + N adjuntos).
--   • `proyectos.responsable_id` = ESPEJO denormalizado del principal, mantenido por
--     trigger → kpi_proyectos, headers y RLS que leen responsable_id siguen igual.
--   • Todos los responsables activos comparten visibilidad/permisos de la obra (ya lo
--     hacen: matriz de confirmación AK4/AT17 y RLS de bitácora AW3/AW5 usan la N:M).
--   • Evidencia real: Torre Alpha (14-ago) tiene 2 ingenieros (Manuel Argel = ENC. OBRA
--     + Jonatha Roman); el rol rota entre listados.
-- =============================================================================

begin;

-- ── 1) Marca de "principal" + un solo principal activo por obra ───────────────
alter table sgc.proyecto_responsables
  add column if not exists es_principal boolean not null default false;
comment on column sgc.proyecto_responsables.es_principal is
  'AV3 — ingeniero PRINCIPAL de la obra (encabezados/reportes). Uno solo por obra (activo).';

create unique index if not exists uq_proyecto_resp_principal
  on sgc.proyecto_responsables (proyecto_id)
  where es_principal and activo;

-- ── 2) Trigger: el principal se espeja a proyectos.responsable_id ─────────────
-- Única dirección de sincronización (N:M → responsable_id). Idempotente y sin
-- recursión: solo actúa cuando la fila es principal+activa.
create or replace function sgc.tg_responsable_principal_sync()
returns trigger language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if coalesce(NEW.es_principal, false) and coalesce(NEW.activo, true) then
    -- Un solo principal por obra: desmarca los demás.
    update sgc.proyecto_responsables
       set es_principal = false
     where proyecto_id = NEW.proyecto_id and id <> NEW.id and es_principal;
    -- Espeja al campo legacy (headers/kpi/RLS que leen responsable_id).
    update sgc.proyectos
       set responsable_id = NEW.usuario_id
     where id = NEW.proyecto_id and responsable_id is distinct from NEW.usuario_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_responsable_principal_sync on sgc.proyecto_responsables;
create trigger trg_responsable_principal_sync
  after insert or update of es_principal, activo, usuario_id on sgc.proyecto_responsables
  for each row execute function sgc.tg_responsable_principal_sync();

-- ── 3) Backfill: convertir el responsable actual de cada obra en su principal ──
-- (a) Si el proyecto tiene responsable_id pero NO existe fila activa suya en la N:M
--     → crearla como principal.
insert into sgc.proyecto_responsables (proyecto_id, usuario_id, tipo_responsabilidad, activo, es_principal, notas)
select p.id, p.responsable_id, 'responsable', true, true, 'AV3 — backfill principal desde responsable_id'
from sgc.proyectos p
where p.responsable_id is not null
  and not exists (select 1 from sgc.proyecto_responsables pr
                   where pr.proyecto_id = p.id and pr.usuario_id = p.responsable_id and coalesce(pr.activo,true))
  and not exists (select 1 from sgc.proyecto_responsables pr
                   where pr.proyecto_id = p.id and pr.es_principal and coalesce(pr.activo,true));

-- (b) Para las obras que AÚN no tienen principal, promover EXACTAMENTE UNA fila activa.
--     Preferencia: (1) la fila cuyo usuario = responsable_id legacy, (2) tipo 'responsable'
--     sobre 'residente'. row_number garantiza un solo principal por obra (evita el
--     caso de un mismo usuario con dos filas responsable+residente).
with ranked as (
  select pr.id,
         row_number() over (
           partition by pr.proyecto_id
           order by (pr.usuario_id is not distinct from p.responsable_id) desc,
                    case pr.tipo_responsabilidad when 'responsable' then 0 when 'residente' then 1 else 2 end,
                    pr.desde nulls last, pr.created_at
         ) as rn
  from sgc.proyecto_responsables pr
  join sgc.proyectos p on p.id = pr.proyecto_id
  where coalesce(pr.activo, true)
    and not exists (select 1 from sgc.proyecto_responsables x
                     where x.proyecto_id = pr.proyecto_id and x.es_principal and coalesce(x.activo,true))
)
update sgc.proyecto_responsables pr
   set es_principal = true
  from ranked r
 where pr.id = r.id and r.rn = 1;

-- ── 4) RPC: designar el ingeniero PRINCIPAL de una obra ───────────────────────
-- Marca principal a un responsable activo. Si el usuario aún no está en el equipo,
-- lo agrega como 'responsable' principal. El trigger espeja a responsable_id.
create or replace function sgc.set_responsable_principal(p_proyecto_id uuid, p_usuario_id uuid)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    raise exception 'No tienes permiso para designar el ingeniero principal.';
  end if;
  if p_proyecto_id is null or p_usuario_id is null then
    raise exception 'Proyecto y usuario son obligatorios.';
  end if;

  -- Si ya existe una fila activa del usuario, márcala principal; si no, créala.
  if exists (select 1 from sgc.proyecto_responsables
             where proyecto_id = p_proyecto_id and usuario_id = p_usuario_id and coalesce(activo,true)) then
    update sgc.proyecto_responsables
       set es_principal = true, activo = true
     where proyecto_id = p_proyecto_id and usuario_id = p_usuario_id and coalesce(activo,true);
  else
    insert into sgc.proyecto_responsables (proyecto_id, usuario_id, tipo_responsabilidad, activo, es_principal, creado_por)
    values (p_proyecto_id, p_usuario_id, 'responsable', true, true, auth.uid());
  end if;
  -- El trigger desmarca a los demás y espeja a responsable_id.
end;
$$;
grant execute on function sgc.set_responsable_principal(uuid, uuid) to authenticated, service_role;

-- ── 5) responsables_de_proyecto devuelve es_principal ─────────────────────────
drop function if exists sgc.responsables_de_proyecto(uuid);
create or replace function sgc.responsables_de_proyecto(p_proyecto_id uuid)
returns table (
  id uuid, usuario_id uuid, nombre text, email text,
  tipo_responsabilidad text, es_principal boolean, activo boolean,
  desde date, hasta date, notas text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select pr.id, pr.usuario_id, u.nombre::text, u.email::text,
         pr.tipo_responsabilidad, coalesce(pr.es_principal, false), coalesce(pr.activo, true),
         pr.desde, pr.hasta, pr.notas
  from sgc.proyecto_responsables pr
  join sgc.usuarios u on u.id = pr.usuario_id
  where pr.proyecto_id = p_proyecto_id
  order by pr.es_principal desc,
           case pr.tipo_responsabilidad when 'responsable' then 0 when 'residente' then 1 else 2 end,
           u.nombre;
$$;
grant execute on function sgc.responsables_de_proyecto(uuid) to authenticated, service_role;

-- ── 6) mis_proyectos: un adjunto (N:M) también ve "sus" obras ─────────────────
create or replace function sgc.mis_proyectos(p_usuario uuid default null::uuid)
returns jsonb language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  with target as (
    select case when sgc.is_admin() then coalesce(p_usuario, auth.uid()) else auth.uid() end as uid
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo), '[]'::jsonb)
  from (
    select p.*,
      coalesce(
        (select jsonb_agg(to_jsonb(f) order by f.orden nulls last, f.created_at)
         from sgc.fases_proyecto f where f.proyecto_id = p.id),
        '[]'::jsonb
      ) as fases,
      enc.encargado_id,
      enc.encargado_nombre
    from sgc.proyectos p, target
    left join lateral (
      select u.id as encargado_id, u.nombre as encargado_nombre
      from sgc.usuarios u
      where u.id = coalesce(
        p.responsable_id,
        (select pr.usuario_id from sgc.proyecto_responsables pr
          where pr.proyecto_id = p.id and coalesce(pr.activo, true)
          order by pr.es_principal desc,
                   case pr.tipo_responsabilidad when 'responsable' then 0 when 'residente' then 1 else 2 end,
                   pr.desde nulls last
          limit 1)
      )
      limit 1
    ) enc on true
    where p.activo = true
      and (
        p.responsable_id = target.uid
        -- AV3 — cualquier ingeniero del equipo (principal o adjunto) ve la obra.
        or exists (
          select 1 from sgc.proyecto_responsables pr
          where pr.proyecto_id = p.id and pr.usuario_id = target.uid and coalesce(pr.activo, true)
        )
        or exists (
          select 1 from sgc.proyecto_empleados pe
          join sgc.empleados e on e.id = pe.empleado_id
          where pe.proyecto_id = p.id and e.usuario_id = target.uid
        )
      )
  ) t;
$function$;

commit;
