-- ════════════════════════════════════════════════════════════════════════════
-- BF2 (parte C) — Los RPCs de Transporte v3 leen/escriben el maestro UNIFICADO
--   `sgc.proveedores` (tipo 'transportista') en vez de `proveedores_transporte`.
--   Cierra la unificación: crear/listar/ratificar/absorber transportistas y el
--   historial de conduces externos pasan al catálogo único. La app (transporte-v3
--   .service) no cambia — solo cambian los cuerpos de estos RPCs.
--
-- REQUIERE bf2b aplicada (columnas transportista_estado/ratificado_* + FKs de
--   conduces_externos/viajes_transporte apuntando a proveedores).
-- Aditivo/retrocompatible en firma (mismos parámetros y columnas de retorno).
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- (1) Alta al vuelo → nace como proveedor tipo transportista, sin_ratificar.
create or replace function sgc.proveedor_transporte_crear(
  p_nombre text, p_telefono text default null, p_contacto text default null,
  p_rnc text default null, p_notas text default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not sgc.puede_crear_conduce() then
    raise exception 'No tienes permiso para registrar proveedores de transporte.';
  end if;
  if nullif(btrim(coalesce(p_nombre,'')),'') is null then
    raise exception 'El nombre del proveedor es obligatorio.';
  end if;
  insert into sgc.proveedores (nombre, telefono, contacto, rnc, tipos, transportista_estado, es_prueba)
  values (btrim(p_nombre), nullif(btrim(p_telefono),''), nullif(btrim(p_contacto),''),
          nullif(btrim(p_rnc),''), array['transportista'], 'sin_ratificar', sgc.usuario_actual_es_prueba())
  returning id into v_id;
  return v_id;
end;
$$;

-- (2) Ratificar → sobre proveedores.transportista_estado.
create or replace function sgc.proveedor_transporte_ratificar(p_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_logistica() then
    raise exception 'Solo Logística puede ratificar proveedores.';
  end if;
  update sgc.proveedores
     set transportista_estado = 'ratificado', ratificado_por = auth.uid(), ratificado_en = now()
   where id = p_id;
end;
$$;

-- (3) Absorber «Otro» textual → proveedor tipo transportista (ratificado) + repunta hijos.
create or replace function sgc.proveedor_transporte_absorber_texto(
  p_texto text, p_nombre text, p_telefono text default null, p_contacto text default null)
returns uuid
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not sgc.es_logistica() then
    raise exception 'Solo Logística puede formalizar proveedores desde texto.';
  end if;
  if nullif(btrim(coalesce(p_texto,'')),'') is null then
    raise exception 'Falta el texto del proveedor a absorber.';
  end if;
  insert into sgc.proveedores (nombre, telefono, contacto, tipos, transportista_estado, ratificado_por, ratificado_en)
  values (btrim(coalesce(p_nombre, p_texto)), nullif(btrim(p_telefono),''), nullif(btrim(p_contacto),''),
          array['transportista'], 'ratificado', auth.uid(), now())
  returning id into v_id;
  update sgc.viajes_transporte
     set proveedor_id = v_id, proveedor_texto = null
   where proveedor_id is null
     and lower(btrim(proveedor_texto)) = lower(btrim(p_texto));
  update sgc.conduces_externos
     set transporta_proveedor_id = v_id, transporta_texto = null
   where transporta_proveedor_id is null
     and lower(btrim(transporta_texto)) = lower(btrim(p_texto));
  return v_id;
end;
$$;

-- (4) Listado (selector + bandeja de ratificación) → desde proveedores (transportista).
--     estado = transportista_estado (un transportista recién marcado, aún sin
--     estado, cuenta como 'sin_ratificar' para que aparezca en la bandeja).
create or replace function sgc.proveedores_transporte_listado(
  p_solo_por_ratificar boolean default false)
returns table(
  id uuid, nombre text, telefono text, contacto text, rnc text, estado text,
  activo boolean, es_prueba boolean, created_at timestamptz,
  viajes_total bigint, viajes_pendientes_pago bigint)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p.id, p.nombre, p.telefono, p.contacto, p.rnc,
         coalesce(p.transportista_estado, 'sin_ratificar') as estado,
         p.activo, p.es_prueba, p.created_at,
         (select count(*) from sgc.viajes_transporte v where v.proveedor_id = p.id) as viajes_total,
         (select count(*) from sgc.viajes_transporte v where v.proveedor_id = p.id and v.estado_pago = 'pendiente_pago') as viajes_pendientes_pago
  from sgc.proveedores p
  where 'transportista' = any(p.tipos)
    and coalesce(p.activo, true)
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(p.es_prueba, false))
    and (not p_solo_por_ratificar or coalesce(p.transportista_estado, 'sin_ratificar') = 'sin_ratificar')
  order by (coalesce(p.transportista_estado, 'sin_ratificar') = 'sin_ratificar') desc, p.nombre;
$$;

-- (5) Historial de conduces externos → JOIN proveedores.
create or replace function sgc.conduces_externos_listado(
  p_estado text default null, p_limite int default 200)
returns table(
  id uuid, transporta text, es_proveedor_formal boolean, estado text,
  origen text, destino text, material text, afecta_inventario boolean,
  placa_foto_path text, carga_foto_path text, recepcion_foto_path text,
  emisor_nombre text, recibido_por_nombre text, recibido_en timestamptz,
  created_at timestamptz, es_prueba boolean, requisicion_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select ce.id,
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
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin() or not coalesce(ce.es_prueba, false))
  order by ce.created_at desc
  limit greatest(1, coalesce(p_limite, 200));
$$;

commit;
