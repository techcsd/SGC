-- =============================================================================
-- PROMPT-10 FASE 2 (AH6/AH7) — cierre del último camino de recepción sin foto.
-- Complemento de 2026-08-07-ah6-ah7-evidencia-obligatoria-server.sql, que endureció
-- entregar_conduce / confirmar_recepcion_salida / registrar_confirmacion_recepcion
-- pero NO tocó `recibir_conduce_app` — el RPC que usa la APP para la recepción en
-- almacén (path "Recibir conduce"). Auditoría de PROMPT-10: ese RPC aceptaba
-- p_foto_path NULL (foto no obligatoria server-side). La regla debe vivir en el
-- servidor (AH6), no solo en la UI. Aditivo: agrega el guard y conserva TODA la
-- lógica existente (idempotencia, autorización, T15/W8 entrada automática).
-- La app ya exige ≥2 fotos en la UI, así que el guard no rompe ningún flujo vivo.
-- =============================================================================

begin;

create or replace function sgc.recibir_conduce_app(p_salida_id uuid, p_items jsonb, p_notas text default null::text, p_foto_path text default null::text)
 returns text
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
  v_autorizado boolean;
  v_bodega_obra_id uuid;
  v_entrada_id uuid;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotency: already received (by the app, a chofer, or the web) → succeed.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    return v_salida.estado;
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  select
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
    into v_autorizado;
  if not v_autorizado then
    raise exception 'No autorizado para recibir este conduce.';
  end if;

  -- AH7 — foto de evidencia OBLIGATORIA en toda confirmación de recepción.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    update sgc.detalle_salidas
    set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por = auth.uid(),
    recibido_en = now(),
    notas_recepcion = p_notas,
    foto_path = coalesce(p_foto_path, foto_path)
  where id = p_salida_id;

  -- ── T15 (W8): entrada automática en el almacén de la obra destino ───────────
  if v_salida.proyecto_id is not null then
    select id into v_bodega_obra_id
    from sgc.bodegas
    where proyecto_id = v_salida.proyecto_id
    limit 1;

    if v_bodega_obra_id is not null
       and v_bodega_obra_id <> v_salida.bodega_id
       and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id)
    then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, salida_id
      ) values (
        current_date, v_bodega_obra_id,
        'Recepción de material despachado a la obra',
        p_notas, auth.uid(),
        'recepcion_obra', v_salida.proyecto_id, p_salida_id
      ) returning id into v_entrada_id;

      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id
        and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$function$;

commit;
