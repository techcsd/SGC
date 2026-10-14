-- ============================================================================
-- CO13 — PROMPT-98 FASE 11 (14/10/2026): Contratos ↔ "Generar Documento"
-- "The module of Contratos... must be able to be connected with the documents
-- generated on Generar Documento" (#223).
--
-- `contratos.documento_generado_id` YA EXISTÍA en prod (columna huérfana, sin
-- FK ni uso en la UI — confirmado por objeto, regla 19). Esta migración:
--   1) le pone la FK que le faltaba (con on delete set null: borrar el
--      documento generado no debe tronar el contrato, solo desvincularlo);
--   2) agrega `archivo_firmado_path` (el PDF/foto firmado subido a mano);
--   3) `contrato_detalle(p_id)` — ficha con el documento enlazado + su URL
--      firmada (bucket privado `contratos-firmados`, igual patrón que
--      `expediente-archivos`).
-- ============================================================================
begin;
set local search_path = sgc, public;

alter table sgc.contratos
  add column if not exists archivo_firmado_path text;
comment on column sgc.contratos.archivo_firmado_path is
  'CO13 — PDF/foto del contrato YA firmado, subido a mano (bucket contratos-firmados).';

-- FK que faltaba (la columna ya vivía en prod, sin referencia real — regla 19).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contratos_documento_generado_id_fkey'
  ) then
    alter table sgc.contratos
      add constraint contratos_documento_generado_id_fkey
      foreign key (documento_generado_id) references sgc.documentos_generados(id) on delete set null;
  end if;
end $$;

create index if not exists idx_contratos_documento_generado on sgc.contratos (documento_generado_id);

create or replace function sgc.contrato_detalle(p_id uuid)
returns jsonb
language sql stable security definer set search_path = sgc, public
as $$
  select jsonb_build_object(
    'contrato', to_jsonb(c) - 'proveedor_id' - 'proyecto_id',
    'proveedor', (select jsonb_build_object('nombre', p.nombre) from sgc.proveedores p where p.id = c.proveedor_id),
    'proyecto', (select jsonb_build_object('nombre', pr.nombre) from sgc.proyectos pr where pr.id = c.proyecto_id),
    'documento', (
      select jsonb_build_object('id', d.id, 'nombre', d.nombre, 'created_at', d.created_at,
                                 'plantilla_nombre', pl.nombre, 'plantilla_categoria', pl.categoria)
      from sgc.documentos_generados d
      left join sgc.plantillas_documento pl on pl.id = d.plantilla_id
      where d.id = c.documento_generado_id
    )
  )
  from sgc.contratos c
  where c.id = p_id;
$$;
grant execute on function sgc.contrato_detalle(uuid) to authenticated;

-- CO13.5 — "Usado en contrato CTR-…" en el Historial de Documentos: contratos
-- que apuntan a cada documento generado (normalmente 0 o 1).
create or replace function sgc.documento_usado_en_contrato(p_documento_id uuid)
returns jsonb
language sql stable security definer set search_path = sgc, public
as $$
  select jsonb_build_object('id', c.id, 'codigo', c.codigo, 'titulo', c.titulo)
  from sgc.contratos c
  where c.documento_generado_id = p_documento_id
  limit 1;
$$;
grant execute on function sgc.documento_usado_en_contrato(uuid) to authenticated;

commit;
