-- =============================================================================
-- PROMPT-25 FASE 3 (BE1) — Resumen semanal de operaciones: infraestructura +
-- reportes 1 (requisiciones por obra/ingeniero) y 2 (estatus + pendientes).
-- Ronda 19/08-01/09/2026 (IDs BE). Aditivo, idempotente, retrocompatible.
--
-- Arquitectura (AU1 — un dato, dos salidas): cada reporte es una TOOL de Compa
-- (SECURITY DEFINER) → se puede PREGUNTAR en el chat cualquier día Y componer en
-- el correo del lunes. Los números del correo = los números de la pantalla.
-- Semana lunes-domingo cerrada (misma def que el incentivo). es_prueba fuera.
-- =============================================================================

begin;

-- ── Destinatarios del resumen (patrón "Quién recibe" AV7, administrable) ─────
-- Operativo (no nómina): más amplio. Default confirmado por Xaviel (PROMPT-25):
-- gerencia/dirección + logística/jefe de flota + admin (Tecnología).
insert into sgc.parametros (clave, valor, descripcion) values
  ('resumen_operaciones_roles',
   'admin,direccion,gerencia,logistica,jefe_flota',
   'BE1 — roles (roles.codigo) que reciben el resumen semanal de operaciones. Administrable.')
on conflict (clave) do nothing;

create or replace function sgc.destinatarios_resumen_operaciones()
returns table (email text, nombre text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and r.codigo = any (sgc.param_csv('resumen_operaciones_roles',
      'admin,direccion,gerencia,logistica,jefe_flota'));
$$;
grant execute on function sgc.destinatarios_resumen_operaciones() to authenticated, service_role;

-- ── Registro de envíos (idempotente por (anio,semana)) — nunca se pierde ─────
create table if not exists sgc.resumen_operaciones_envio (
  anio          int not null,
  semana        int not null,
  destinatarios jsonb,
  ok            boolean not null default false,
  error         text,
  enviado_at    timestamptz not null default now(),
  primary key (anio, semana)
);
alter table sgc.resumen_operaciones_envio enable row level security;
drop policy if exists roe_select_tec on sgc.resumen_operaciones_envio;
create policy roe_select_tec on sgc.resumen_operaciones_envio
  for select to authenticated using (sgc.es_tecnologia() or sgc.is_admin());

-- ── Helper de rango de semana (reusa la matemática ISO del incentivo) ────────
-- inicio = lunes ISO; fin = domingo. Devuelve ambas fechas.
create or replace function sgc.semana_rango(p_anio int, p_semana int)
returns table (inicio date, fin date)
language sql immutable
set search_path to 'sgc', 'pg_temp'
as $$
  select ini, ini + 6
  from (select to_date(p_anio::text || '-' || lpad(p_semana::text, 2, '0'), 'IYYY-IW') as ini) t;
$$;
grant execute on function sgc.semana_rango(int, int) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 1 — Requisiciones por obra y por ingeniero solicitante.
--   Tabla obra × ingeniero + totales. Fuente: solicitudes_material (created_at en
--   la semana). es_prueba se filtra por la obra (solicitudes_material no lo tiene).
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_requisiciones_semana(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with reqs as (
      select sm.id,
             coalesce(p.codigo || ' · ' || p.nombre, p.nombre, 'Sin obra') as obra,
             coalesce(u.nombre, 'Sin ingeniero') as ingeniero
      from sgc.solicitudes_material sm
      join sgc.proyectos p on p.id = sm.proyecto_id
      left join sgc.usuarios u on u.id = sm.solicitante_id
      where (sm.created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin
        and not coalesce(p.es_prueba, false)
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'total', (select count(*) from reqs),
      'matriz', coalesce((
        select jsonb_agg(jsonb_build_object('obra', obra, 'ingeniero', ingeniero, 'cantidad', n)
                 order by n desc, obra)
        from (select obra, ingeniero, count(*) n from reqs group by obra, ingeniero) m), '[]'::jsonb),
      'por_obra', coalesce((
        select jsonb_agg(jsonb_build_object('obra', obra, 'cantidad', n) order by n desc)
        from (select obra, count(*) n from reqs group by obra) o), '[]'::jsonb),
      'por_ingeniero', coalesce((
        select jsonb_agg(jsonb_build_object('ingeniero', ingeniero, 'cantidad', n) order by n desc)
        from (select ingeniero, count(*) n from reqs group by ingeniero) g), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_requisiciones_semana(int, int) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- REPORTE 2 — Estatus de las requisiciones (embudo + pendientes por atender).
--   Embudo: creadas / aprobadas / despachadas (parcial/total, BA6 derivado) /
--   canceladas / rechazadas. Pendientes por atender CON SU EDAD (la sección de
--   más valor gerencial): REQ-###### · obra · N días esperando.
--   Despacho derivado (AU1, misma lógica que requisicion_avance): compara lo
--   solicitado vs lo despachado por salidas vinculadas (origen_requisicion_id).
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function sgc.resumen_estatus_requisiciones(
  p_anio int default null, p_semana int default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  return (
    with reqs as (
      select sm.id, sm.estado, sm.created_at, sm.folio,
             coalesce(p.codigo || ' · ' || p.nombre, p.nombre, 'Sin obra') as obra,
             coalesce(u.nombre, 'Sin ingeniero') as ingeniero,
             coalesce((select sum(smi.cantidad) from sgc.solicitud_material_items smi
                       where smi.solicitud_id = sm.id), 0) as solicitado,
             coalesce((select sum(ds.cantidad)
                       from sgc.salidas_inventario s
                       join sgc.detalle_salidas ds on ds.salida_id = s.id
                       where s.origen_requisicion_id = sm.id
                         and coalesce(s.estado,'') <> 'anulado'), 0) as despachado
      from sgc.solicitudes_material sm
      join sgc.proyectos p on p.id = sm.proyecto_id
      left join sgc.usuarios u on u.id = sm.solicitante_id
      where (sm.created_at at time zone 'America/Santo_Domingo')::date between v_ini and v_fin
        and not coalesce(p.es_prueba, false)
    ),
    clasif as (
      select *,
        case
          when estado in ('cancelada','rechazada') then 'cancelada'
          when despachado > 0 and despachado >= solicitado and solicitado > 0 then 'despachada_total'
          when despachado > 0 then 'despachada_parcial'
          when estado in ('entregada','cerrada','completada') then 'despachada_total'
          when estado in ('aprobada','por_despachar') then 'aprobada'
          else 'pendiente'
        end as fase
      from reqs
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'embudo', jsonb_build_object(
        'creadas',            (select count(*) from clasif),
        'pendientes',         (select count(*) from clasif where fase = 'pendiente'),
        'aprobadas',          (select count(*) from clasif where fase = 'aprobada'),
        'despachadas_parcial',(select count(*) from clasif where fase = 'despachada_parcial'),
        'despachadas_total',  (select count(*) from clasif where fase = 'despachada_total'),
        'canceladas',         (select count(*) from clasif where fase = 'cancelada')
      ),
      -- Pendientes por atender (pendiente o parcial) con su edad, más viejas primero.
      'pendientes_por_atender', coalesce((
        select jsonb_agg(jsonb_build_object(
          'codigo', case when folio is not null then 'REQ-' || lpad(folio::text, 6, '0') else '(sin folio)' end,
          'obra', obra, 'ingeniero', ingeniero,
          'dias_esperando', greatest(0, (now()::date - created_at::date)),
          'fase', fase) order by created_at asc)
        from clasif where fase in ('pendiente','aprobada','despachada_parcial')), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function sgc.resumen_estatus_requisiciones(int, int) to authenticated, service_role;

commit;
