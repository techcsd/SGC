-- ============================================================================
-- CC5 (PROMPT-74 F6) — El conduce externo es un conduce de verdad (ver/revisar/
-- imprimir). Nota #88: «the "conduces externos" must create a conduce like the
-- normal ones, that can be showed and reviewed. that will contains the details
-- and all the stuff.»
-- ----------------------------------------------------------------------------
-- Ya existen: conduces_externos_listado, crear_conduce_externo,
-- conduce_externo_confirmar_receptor, conduce_externo_anular. Faltaba: número
-- visible CE-000123, una FICHA (detalle completo) y el historial de estados.
--
-- ADITIVO: columna `numero` + secuencia + backfill; el listado gana numero/codigo;
-- RPC de detalle (definer, mismo alcance que el listado) con renglones (si
-- afecta inventario), fotos, firmas y un historial DERIVADO de los sellos de
-- tiempo (created_at→emitido, recibido_en→recibido, anulado_en→anulado) — sin
-- trigger ni tocar los RPC existentes.
--
-- BU1 (regla 18): --env dev primero, probar, luego --env prod --yes.
-- ============================================================================

begin;

-- ── 1) Número visible CE-000123 ──────────────────────────────────────────────
alter table sgc.conduces_externos add column if not exists numero bigint;
create sequence if not exists sgc.conduce_externo_numero_seq;

with ordenado as (
  select id, row_number() over (order by created_at, id) as rn
  from sgc.conduces_externos where numero is null
)
update sgc.conduces_externos ce set numero = o.rn
  from ordenado o where ce.id = o.id;

select setval('sgc.conduce_externo_numero_seq',
              coalesce((select max(numero) from sgc.conduces_externos), 0) + 1, false);
alter table sgc.conduces_externos
  alter column numero set default nextval('sgc.conduce_externo_numero_seq');
create unique index if not exists uq_conduce_externo_numero on sgc.conduces_externos(numero);
grant usage, select on sequence sgc.conduce_externo_numero_seq to authenticated, service_role;
comment on column sgc.conduces_externos.numero is 'CC5 — número visible CE-000123.';

-- ── 2) El listado gana numero/codigo (drop+recreate: cambia el TABLE de salida) ─
drop function if exists sgc.conduces_externos_listado(text, integer);
create function sgc.conduces_externos_listado(p_estado text default null, p_limite integer default 200)
returns table (
  id uuid, numero bigint, codigo text, transporta text, es_proveedor_formal boolean,
  estado text, origen text, destino text, material text, afecta_inventario boolean,
  placa_foto_path text, carga_foto_path text, recepcion_foto_path text,
  emisor_nombre text, recibido_por_nombre text, recibido_en timestamptz,
  created_at timestamptz, es_prueba boolean, requisicion_id uuid
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select ce.id, ce.numero,
         'CE-' || lpad(coalesce(ce.numero, 0)::text, 6, '0') as codigo,
         coalesce(p.nombre, ce.transporta_texto) as transporta,
         (ce.transporta_proveedor_id is not null) as es_proveedor_formal,
         ce.estado, ce.origen, ce.destino, ce.material_descripcion, ce.afecta_inventario,
         ce.placa_foto_path, ce.carga_foto_path, ce.recepcion_foto_path,
         ue.nombre as emisor_nombre, ur.nombre as recibido_por_nombre, ce.recibido_en,
         ce.created_at, ce.es_prueba, ce.origen_requisicion_id
  from sgc.conduces_externos ce
  left join sgc.proveedores p on p.id = ce.transporta_proveedor_id
  left join sgc.usuarios ue on ue.id = ce.emisor_usuario_id
  left join sgc.usuarios ur on ur.id = ce.recibido_por
  where (p_estado is null or ce.estado = p_estado)
  order by ce.created_at desc
  limit greatest(coalesce(p_limite, 200), 1);
$function$;
grant execute on function sgc.conduces_externos_listado(text, integer) to authenticated, service_role;

-- ── 3) Ficha (detalle completo) del conduce externo ──────────────────────────
create or replace function sgc.conduce_externo_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'id', ce.id,
    'numero', ce.numero,
    'codigo', 'CE-' || lpad(coalesce(ce.numero,0)::text, 6, '0'),
    'estado', ce.estado,
    'fecha', ce.created_at,
    'transporta', coalesce(p.nombre, ce.transporta_texto),
    'es_proveedor_formal', (ce.transporta_proveedor_id is not null),
    'material', ce.material_descripcion,
    'afecta_inventario', ce.afecta_inventario,
    'salida_id', ce.salida_id,
    'entrada_id', ce.entrada_id,
    'origen', ce.origen,
    'destino', ce.destino,
    'origen_proyecto', po.nombre,
    'origen_bodega', bo.nombre,
    'destino_proyecto', pd.nombre,
    'destino_bodega', bd.nombre,
    'emisor', ue.nombre,
    'emisor_firma_path', ce.emisor_firma_path,
    'receptor', ur.nombre,
    'receptor_firma_path', ce.receptor_firma_path,
    'recibido_en', ce.recibido_en,
    'notas', ce.notas,
    'notas_recepcion', ce.notas_recepcion,
    'placa_foto_path', ce.placa_foto_path,
    'carga_foto_path', ce.carga_foto_path,
    'recepcion_foto_path', ce.recepcion_foto_path,
    'requisicion_id', ce.origen_requisicion_id,
    'anulado', (ce.anulado_en is not null),
    'motivo_anulacion', ce.motivo_anulacion,
    'es_prueba', ce.es_prueba,
    -- Renglones estructurados si afecta inventario (via la salida vinculada).
    'renglones', case when ce.salida_id is not null then coalesce((
        select jsonb_agg(jsonb_build_object(
          'articulo', a.nombre, 'enviado', d.cantidad,
          'recibido', d.cantidad_recibida, 'unidad', d.unidad_capturada) order by a.nombre)
        from sgc.detalle_salidas d left join sgc.articulos a on a.id = d.articulo_id
        where d.salida_id = ce.salida_id), '[]'::jsonb) else '[]'::jsonb end,
    -- Historial DERIVADO de los sellos de tiempo.
    'historial', (
      select jsonb_agg(h order by (h->>'at')::timestamptz)
      from (
        select jsonb_build_object('estado','emitido','at',ce.created_at) as h
        union all
        select jsonb_build_object('estado','recibido','at',ce.recibido_en) where ce.recibido_en is not null
        union all
        select jsonb_build_object('estado','anulado','at',ce.anulado_en) where ce.anulado_en is not null
      ) hs
    )
  )
  into v
  from sgc.conduces_externos ce
  left join sgc.proveedores p on p.id = ce.transporta_proveedor_id
  left join sgc.usuarios ue on ue.id = ce.emisor_usuario_id
  left join sgc.usuarios ur on ur.id = ce.recibido_por
  left join sgc.proyectos po on po.id = ce.origen_proyecto_id
  left join sgc.bodegas bo on bo.id = ce.origen_bodega_id
  left join sgc.proyectos pd on pd.id = ce.destino_proyecto_id
  left join sgc.bodegas bd on bd.id = ce.destino_bodega_id
  where ce.id = p_id;

  if v is null then raise exception 'Conduce externo no encontrado.'; end if;
  return v;
end;
$$;
grant execute on function sgc.conduce_externo_detalle(uuid) to authenticated, service_role;

commit;
