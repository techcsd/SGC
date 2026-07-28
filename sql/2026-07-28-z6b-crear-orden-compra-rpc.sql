-- ============================================================================
-- Z6b — crear_orden_compra: persistir destino, aplica_impuesto, es_prueba
-- PROMPT-6 · FASE 3
-- ============================================================================
-- Se reemplaza la firma de 11 args por una de 14 (los 3 nuevos con DEFAULT →
-- los llamadores viejos de 11 args siguen funcionando; sin overload ambiguo).
-- ============================================================================

drop function if exists sgc.crear_orden_compra(uuid,uuid,text,date,date,numeric,numeric,numeric,text,uuid,jsonb);

create or replace function sgc.crear_orden_compra(
  p_proveedor_id uuid,
  p_proyecto_id uuid,
  p_estado text,
  p_fecha date,
  p_fecha_entrega_esperada date,
  p_subtotal numeric,
  p_impuesto numeric,
  p_total numeric,
  p_notas text,
  p_creado_por uuid,
  p_items jsonb,
  p_destino text default 'proyecto',
  p_aplica_impuesto boolean default true,
  p_es_prueba boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_numero text;
  v_orden_id uuid;
  v_destino text := coalesce(p_destino, 'proyecto');
begin
  v_numero := 'OC-' || to_char(now(),'YYYYMM') || '-' ||
              lpad(nextval('sgc.ordenes_compra_numero_seq')::text, 4, '0');

  insert into sgc.ordenes_compra (
    numero, proveedor_id, proyecto_id, estado, fecha, fecha_entrega_esperada,
    subtotal, impuesto, total, notas, creado_por,
    destino, aplica_impuesto, es_prueba, es_prueba_origen
  ) values (
    v_numero, p_proveedor_id,
    case when v_destino = 'oficina' then null else p_proyecto_id end,
    coalesce(p_estado, 'borrador'), p_fecha, p_fecha_entrega_esperada,
    p_subtotal, p_impuesto, p_total, p_notas, p_creado_por,
    v_destino, coalesce(p_aplica_impuesto, true),
    coalesce(p_es_prueba, false),
    case when coalesce(p_es_prueba, false) then 'manual' end
  )
  returning id into v_orden_id;

  insert into sgc.orden_compra_items (orden_id, articulo_id, descripcion, cantidad, precio_unitario, total)
  select v_orden_id, nullif(i->>'articulo_id','')::uuid, i->>'descripcion',
         (i->>'cantidad')::numeric, (i->>'precio_unitario')::numeric, (i->>'total')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_orden_id;
end;
$function$;

grant execute on function sgc.crear_orden_compra(uuid,uuid,text,date,date,numeric,numeric,numeric,text,uuid,jsonb,text,boolean,boolean) to authenticated, service_role;
