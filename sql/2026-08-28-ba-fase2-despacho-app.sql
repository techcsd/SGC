-- ============================================================================
-- BA / TRANSPORTE V3 — FASE 2 (app) — Motor de DESPACHO desde la app del chofer.
-- Cierra el hueco de fase3: el chofer necesita (a) enlazar el conduce que crea a
-- la requisición y (b) ver las requisiciones "por despachar".
--
-- Diseño: NO se toca crear_conduce_simple (RPC núcleo). En su lugar, un enlace
-- posterior `despacho_marcar` que el creador del conduce puede llamar — el handler
-- del outbox `conduce_simple` lo invoca tras crear el conduce cuando trae requisición.
-- Todo aditivo/retrocompatible. El flag `requisicion_auto_conduce` sigue en TRUE
-- (nada cambia) hasta que Xaviel lo apague cuando la app esté probada.
-- Apply: node scripts/apply-migration.mjs sql/2026-08-28-ba-fase2-despacho-app.sql
-- ============================================================================
begin;
set local search_path = sgc, public;

-- (1) Enlaza un conduce (salida) ya creado a una requisición (despacho). Lo puede
--     hacer quien crea conduces (chofer/inventario/admin) o Logística. Solo enlaza
--     si aún no tenía requisición (idempotente / no pisa un enlace previo).
create or replace function sgc.despacho_marcar(p_salida_id uuid, p_requisicion_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.puede_crear_conduce() or sgc.es_logistica()) then
    raise exception 'No tienes permiso para vincular despachos.';
  end if;
  update sgc.salidas_inventario
     set origen_requisicion_id = p_requisicion_id
   where id = p_salida_id
     and origen_requisicion_id is null;
end;
$$;
grant execute on function sgc.despacho_marcar(uuid, uuid) to authenticated, service_role;

-- (2) requisiciones_por_despachar — lista para el chofer/logística (estado por_despachar).
--     solicitudes_material NO tiene es_prueba → se filtra por el proyecto.
create or replace function sgc.requisiciones_por_despachar()
returns table(
  id uuid, proyecto_id uuid, proyecto_nombre text, solicitante text,
  fecha date, renglones bigint, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sm.id, sm.proyecto_id, p.nombre::text, u.nombre::text, sm.created_at::date,
         (select count(*) from sgc.solicitud_material_items i where i.solicitud_id = sm.id),
         sm.created_at
  from sgc.solicitudes_material sm
  left join sgc.proyectos p on p.id = sm.proyecto_id
  left join sgc.usuarios u on u.id = sm.solicitante_id
  where sm.estado = 'por_despachar'
    and sgc.puede_crear_conduce()
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin()
         or not exists (select 1 from sgc.proyectos pp
                        where pp.id = sm.proyecto_id and coalesce(pp.es_prueba, false)))
  order by sm.created_at desc;
$$;
grant execute on function sgc.requisiciones_por_despachar() to authenticated, service_role;

-- (3) ¿la requisición ya tiene despachos en curso? (aviso suave de duplicado, F2).
create or replace function sgc.requisicion_tiene_despachos(p_solicitud_id uuid)
returns int
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int
  from sgc.salidas_inventario s
  where s.origen_requisicion_id = p_solicitud_id
    and coalesce(s.anulado_por is null, true);
$$;
grant execute on function sgc.requisicion_tiene_despachos(uuid) to authenticated, service_role;

commit;
