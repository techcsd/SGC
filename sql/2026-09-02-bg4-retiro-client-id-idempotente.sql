-- =============================================================================
-- PROMPT-29 (BG4 follow-up) — idempotencia del retiro por client_id.
-- Ronda 19/08-03/09/2026. Aditivo, retrocompatible (nueva sobrecarga 9-arg; la
-- 8-arg original sigue viva para apps viejas — regla RPC ≥2 versiones).
--
-- El contrato BG4 marcó este follow-up: crear_retiro_material no recibía un id de
-- cliente, así que un reintento tras un fix (o tras perder el ack de red) podía
-- DUPLICAR el retiro. Con la clave de idempotencia del cliente, un reenvío con el
-- mismo p_client_id DEVUELVE el retiro existente en vez de crear otro — el mismo
-- patrón que crear_bitacora_app. Cierra el hueco para el reintento post-fix (F3).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-02-bg4-retiro-client-id-idempotente.sql
-- =============================================================================
begin;

alter table sgc.retiros_material add column if not exists client_id uuid;
create unique index if not exists uq_retiros_material_client_id
  on sgc.retiros_material (client_id) where client_id is not null;

create or replace function sgc.crear_retiro_material(
  p_proyecto_id uuid,
  p_almacen_destino_id uuid,
  p_motivo_dano text,
  p_motivo_dano_detalle text,
  p_notas text,
  p_items jsonb,
  p_fotos jsonb,
  p_es_prueba boolean,
  p_client_id uuid
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Idempotencia: si ya existe un retiro con este client_id, devolverlo (no duplica).
  if p_client_id is not null then
    select id into v_id from sgc.retiros_material where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  if p_proyecto_id is null then
    raise exception using errcode='22023', message='Indica la obra del material dañado.',
      detail='{"campo":"proyecto_id","motivo":"requerido"}';
  end if;
  if p_motivo_dano is null or p_motivo_dano not in ('danado_obra','defecto_fabrica','vencido','otro') then
    raise exception using errcode='22023', message='Indica el motivo del daño.',
      detail='{"campo":"motivo_dano","motivo":"requerido"}';
  end if;
  if coalesce(jsonb_array_length(p_items),0) = 0 then
    raise exception using errcode='22023', message='Agrega al menos un artículo a retirar.',
      detail='{"campo":"items","motivo":"requerido"}';
  end if;
  if coalesce(jsonb_array_length(p_fotos),0) = 0 then
    raise exception using errcode='22023', message='Agrega al menos una foto del material dañado.',
      detail='{"campo":"fotos","motivo":"requerido"}';
  end if;

  insert into sgc.retiros_material
    (proyecto_id, solicitante_id, almacen_destino_id, motivo_dano, motivo_dano_detalle, notas, es_prueba, client_id)
  values
    (p_proyecto_id, v_uid, p_almacen_destino_id, p_motivo_dano,
     nullif(trim(p_motivo_dano_detalle),''), nullif(trim(p_notas),''), coalesce(p_es_prueba,false), p_client_id)
  returning id into v_id;

  insert into sgc.retiro_material_items (retiro_id, articulo_id, descripcion, cantidad, unidad)
  select v_id,
         nullif(i->>'articulo_id','')::uuid,
         coalesce(nullif(trim(i->>'descripcion'),''), 'Artículo'),
         (i->>'cantidad')::numeric,
         nullif(trim(i->>'unidad'),'')
  from jsonb_array_elements(p_items) i;

  insert into sgc.retiro_material_fotos (retiro_id, path, nombre)
  select v_id, i->>'path', nullif(i->>'nombre','')
  from jsonb_array_elements(p_fotos) i
  where nullif(i->>'path','') is not null;

  begin
    perform sgc.notificar_modulo('inventario', 'retiro_material',
      'Nuevo retiro de material dañado',
      'RET-' || lpad((select folio::text from sgc.retiros_material where id=v_id),6,'0')
        || ' — ' || coalesce((select nombre from sgc.proyectos where id=p_proyecto_id),'obra'),
      '/inventario/retiros?item=' || v_id::text);
  exception when others then null; end;

  return v_id;
end;
$$;
grant execute on function sgc.crear_retiro_material(uuid,uuid,text,text,text,jsonb,jsonb,boolean,uuid)
  to authenticated, service_role;

commit;
