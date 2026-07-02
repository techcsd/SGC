-- Fixes from a full security/bug review of this session's new features
-- (Bitácora + solicitudes workflow, Documentos + template engine). The two
-- client-side XSS fixes (escapeHtml missing single-quote escaping;
-- unsanitized contenteditable preview persisted verbatim) are code-only —
-- see plantillas-documento.service.ts and documentos/generar/generar.ts.
-- This file covers everything that needed a DB-side change.

-- ═══════════════════════════════════════════════════════════
-- 1. documentos_generados RLS leaked project-scoped documents to
--    anyone with generic 'documentos' access, unlike documentos_proyecto
--    which correctly scopes by proyecto_empleados. Fix: project-scoped
--    generated documents now require the same team/proyectos-module
--    check; only project-less documents (proyecto_id is null) fall back
--    to generic 'documentos' access.
-- ═══════════════════════════════════════════════════════════
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
  );

drop policy "documentos_generados: delete" on sgc.documentos_generados;
create policy "documentos_generados: delete" on sgc.documentos_generados for delete to authenticated
  using (
    sgc.is_admin()
    or (proyecto_id is null and sgc.tiene_modulo('documentos'))
    or (proyecto_id is not null and sgc.tiene_modulo('proyectos'))
  );

-- ═══════════════════════════════════════════════════════════
-- 2. sgc-documentos storage policies only checked bucket_id — any
--    authenticated user could list/download/delete ANY project's files
--    directly via the Storage API, bypassing documentos_proyecto's table
--    RLS entirely. Scope by the proyecto_id folder segment (upload path
--    is `${proyectoId}/${tipo}/${uuid}-${filename}`, matching the
--    existing table policy's logic). Also restrict upload MIME types and
--    cap file size, since the client-side .docx extension check is
--    trivially spoofable.
-- ═══════════════════════════════════════════════════════════
drop policy "sgc-documentos: authenticated read" on storage.objects;
drop policy "sgc-documentos: authenticated upload" on storage.objects;
drop policy "sgc-documentos: authenticated delete" on storage.objects;

create policy "sgc-documentos: scoped read" on storage.objects for select to authenticated
  using (
    bucket_id = 'sgc-documentos'
    and (
      sgc.is_admin() or sgc.tiene_modulo('proyectos')
      or exists (
        select 1 from sgc.proyecto_empleados pe
        join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id::text = (storage.foldername(name))[1] and e.usuario_id = auth.uid()
      )
    )
  );
create policy "sgc-documentos: scoped upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-documentos' and (sgc.is_admin() or sgc.tiene_modulo('proyectos')));
create policy "sgc-documentos: scoped delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sgc-documentos' and (sgc.is_admin() or sgc.tiene_modulo('proyectos')));

update storage.buckets set
  file_size_limit = 26214400, -- 25MB
  allowed_mime_types = array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       -- .xlsx
    'application/vnd.ms-excel',
    'application/pdf',
    'image/png', 'image/jpeg'
  ]
where id = 'sgc-documentos';

-- ═══════════════════════════════════════════════════════════
-- 3. solicitudes_material / solicitudes_compra UPDATE policies had no
--    WITH CHECK, and the frontend "approve/reject" step is a raw client
--    .update() (not an RPC) — so any user holding the inventario/compras
--    module could, via a direct PostgREST call, forge the approver,
--    re-process an already-decided request, point salida_id/orden_compra_id
--    at an unrelated record, or approve their own request. Close all of
--    that at the RLS layer so it holds regardless of what the client
--    sends, without changing the SECURITY INVOKER convention used
--    everywhere else in this schema.
-- ═══════════════════════════════════════════════════════════
drop policy "solicitudes_material: update" on sgc.solicitudes_material;
create policy "solicitudes_material: update" on sgc.solicitudes_material for update to authenticated
  using ((sgc.is_admin() or sgc.tiene_modulo('inventario')) and estado = 'pendiente')
  with check (
    atendido_por = auth.uid()
    and estado in ('rechazada', 'entregada')
    and (sgc.is_admin() or solicitante_id <> auth.uid())
    -- NOTE: subquery columns must be qualified against the outer table by
    -- name (solicitudes_material.proyecto_id) — an earlier unqualified
    -- version silently resolved to si.proyecto_id = si.proyecto_id (always
    -- true), making this check a no-op. Caught via pg_policies inspection
    -- right after applying, fixed before this ever shipped unverified.
    and (salida_id is null or exists (
      select 1 from sgc.salidas_inventario si
      where si.id = solicitudes_material.salida_id
        and (si.proyecto_id is null or si.proyecto_id = solicitudes_material.proyecto_id)
    ))
  );

drop policy "solicitudes_compra: update" on sgc.solicitudes_compra;
create policy "solicitudes_compra: update" on sgc.solicitudes_compra for update to authenticated
  using ((sgc.is_admin() or sgc.tiene_modulo('compras')) and estado = 'pendiente')
  with check (
    atendido_por = auth.uid()
    and estado in ('rechazada', 'convertida')
    and (sgc.is_admin() or solicitante_id <> auth.uid())
    and (orden_compra_id is null or exists (
      select 1 from sgc.ordenes_compra oc
      where oc.id = solicitudes_compra.orden_compra_id
        and (oc.proyecto_id is null or oc.proyecto_id = solicitudes_compra.proyecto_id)
    ))
  );

-- Known remaining gap (accepted trade-off, not fixed here): approving a
-- solicitud is still two separate network calls (create the real
-- salida/orden, then mark the solicitud attended) rather than one atomic
-- transaction — a failure between the two leaves the solicitud stuck at
-- "pendiente" even though the real record was created. This is a rare
-- reliability edge case now (the authorization holes above are closed),
-- not a security hole; fully fixing it means merging
-- salidas/ordenes-compra creation and solicitud-approval into one RPC.
