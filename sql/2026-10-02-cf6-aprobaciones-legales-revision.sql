-- CF6 — Aprobaciones legales: "Cannot coerce the result to a single JSON object" al revisar
-- -------------------------------------------------------------------------------------
-- Causa exacta: aprobaciones/aprobaciones.ts carga el documento con
--   plantillas-documento.service.ts getGeneradoById → documentos_generados … .single().
--   La política select de documentos_generados (2026-07-02-security-review-fixes.sql)
--   sólo deja ver el documento a admin, a quien lo generó, o con módulo documentos sin
--   obra.  Sonia (legal) no generó la Carta de Entrega → 0 filas → .single() lanza el
--   error.  Además "Solicitado por" sale "—" por el embed a usuarios bajo RLS (patrón CE2).
-- Fix:
--   (1) RPC definer documento_para_revision(p_solicitud) — el revisor legal/admin lee el
--       documento de la solicitud que debe aprobar (null si el documento fue eliminado).
--   (2) RPC definer listar_aprobaciones_legales() con solicitante/revisor ya resueltos.
--   (3) Política de documentos_generados ampliada: legal/abogado ve documentos que una
--       solicitud de aprobación referencia (quien revisa debe poder leer lo que aprueba).
-- -------------------------------------------------------------------------------------

-- ── (1) documento_para_revision ──────────────────────────────────────────────────────
create or replace function sgc.documento_para_revision(p_solicitud uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_sol sgc.aprobaciones_legales;
  v_doc jsonb;
begin
  select * into v_sol from sgc.aprobaciones_legales where id = p_solicitud;
  if not found then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('legal') or v_sol.solicitado_por = auth.uid()) then
    raise exception 'No autorizado para revisar esta solicitud' using errcode = '42501';
  end if;
  if v_sol.referencia_tipo is distinct from 'documento_generado' or v_sol.referencia_id is null then
    return null; -- la solicitud no tiene documento adjunto
  end if;
  select to_jsonb(dg)
    || jsonb_build_object(
         'plantilla', (select jsonb_build_object('nombre', pl.nombre, 'categoria', pl.categoria)
                         from sgc.plantillas_documento pl where pl.id = dg.plantilla_id),
         'proyecto', (select jsonb_build_object('nombre', pr.nombre)
                        from sgc.proyectos pr where pr.id = dg.proyecto_id),
         'solicitado_por_nombre', (select u.nombre from sgc.usuarios u where u.id = v_sol.solicitado_por)
       )
    into v_doc
  from sgc.documentos_generados dg
  where dg.id = v_sol.referencia_id;
  return v_doc; -- null si el documento ya fue eliminado → la UI muestra mensaje humano
end;
$function$;
grant execute on function sgc.documento_para_revision(uuid) to authenticated;

-- ── (2) listar_aprobaciones_legales — nombres resueltos sin depender del embed RLS ────
create or replace function sgc.listar_aprobaciones_legales()
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(
    to_jsonb(al)
    || jsonb_build_object(
         'solicitante', (select jsonb_build_object('nombre', u.nombre) from sgc.usuarios u where u.id = al.solicitado_por),
         'revisor',     (select jsonb_build_object('nombre', u.nombre) from sgc.usuarios u where u.id = al.revisado_por)
       )
    order by al.fecha_solicitud desc), '[]'::jsonb)
  from sgc.aprobaciones_legales al
  where sgc.is_admin() or sgc.tiene_modulo('legal') or al.solicitado_por = auth.uid();
$function$;
grant execute on function sgc.listar_aprobaciones_legales() to authenticated;

-- ── (3) Política de documentos_generados ampliada a revisores legales ─────────────────
drop policy "documentos_generados: select" on sgc.documentos_generados;
create policy "documentos_generados: select" on sgc.documentos_generados for select to authenticated
  using (
    sgc.is_admin()
    or generado_por = auth.uid()
    or (proyecto_id is null and sgc.tiene_modulo('documentos'))
    or (
      proyecto_id is not null and (
        sgc.tiene_modulo('proyectos')
        or exists (
          select 1 from sgc.proyecto_empleados pe
          join sgc.empleados e on e.id = pe.empleado_id
          where pe.proyecto_id = documentos_generados.proyecto_id and e.usuario_id = auth.uid()
        )
      )
    )
    -- CF6: el revisor legal puede leer el documento que una solicitud de aprobación referencia.
    or (
      sgc.tiene_modulo('legal')
      and exists (
        select 1 from sgc.aprobaciones_legales al
        where al.referencia_tipo = 'documento_generado'
          and al.referencia_id = documentos_generados.id
      )
    )
  );
