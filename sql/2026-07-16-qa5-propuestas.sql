-- ============================================================================
-- Actualización 5 — propuestas aprobadas (esquema)
--   QA-071: tec_equipos + costo, fecha_compra, garantia_hasta.
--   QA-070: tec_equipos + origen_solicitud_compra_id (trazabilidad compra↔equipo).
--   QA-075: expedientes_legales + enlace (enlace externo del expediente legal).
--   QA-032: RPC registrar_asistencia_por_ausencia — al aprobar una ausencia,
--           crea asistencia (permiso/ausente) por cada día del rango (idempotente).
-- Aditivo/retrocompatible/idempotente.
-- ============================================================================

set search_path = sgc, public;

-- ── QA-071 / QA-070 · Inventario TI ─────────────────────────────────────────
alter table sgc.tec_equipos
  add column if not exists costo numeric,
  add column if not exists fecha_compra date,
  add column if not exists garantia_hasta date,
  add column if not exists origen_solicitud_compra_id uuid references sgc.solicitudes_compra(id);

-- ── QA-075 · Enlace externo del expediente legal ────────────────────────────
alter table sgc.expedientes_legales add column if not exists enlace text;

-- ── QA-032 · Ausencia aprobada → registros de asistencia ────────────────────
create or replace function sgc.registrar_asistencia_por_ausencia(p_ausencia_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_a       sgc.solicitudes_ausencia%rowtype;
  v_estado  text;
  v_dia     date;
  v_n       int := 0;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('rrhh')) then
    raise exception 'No autorizado.';
  end if;

  select * into v_a from sgc.solicitudes_ausencia where id = p_ausencia_id;
  if not found then raise exception 'Ausencia no encontrada.'; end if;
  if v_a.estado <> 'aprobada' then
    raise exception 'La ausencia debe estar aprobada.';
  end if;

  -- Vacaciones/permiso/personal → 'permiso'; el resto (enfermedad, etc.) → 'ausente'.
  v_estado := case when lower(coalesce(v_a.tipo,'')) in ('vacaciones','permiso','personal')
                   then 'permiso' else 'ausente' end;

  v_dia := v_a.fecha_inicio;
  while v_dia <= v_a.fecha_fin loop
    -- Idempotente: no duplica si ya hay asistencia para ese empleado/día.
    if not exists (select 1 from sgc.asistencia a
                   where a.empleado_id = v_a.empleado_id and a.fecha = v_dia) then
      insert into sgc.asistencia (empleado_id, fecha, estado, notas)
      values (v_a.empleado_id, v_dia, v_estado,
              'Generado por ausencia aprobada (' || coalesce(v_a.tipo,'ausencia') || ').');
      v_n := v_n + 1;
    end if;
    v_dia := v_dia + 1;
  end loop;

  return v_n;
end;
$function$;
grant execute on function sgc.registrar_asistencia_por_ausencia(uuid) to authenticated, service_role;
