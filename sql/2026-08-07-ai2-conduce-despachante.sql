-- ============================================================================
-- AI2 — Conduce simplificado: DESPACHANTE + foto de recepción + firmas
--       chofer + despachante (refina AH4). SGC padre. Aditivo/retrocompatible.
-- ----------------------------------------------------------------------------
-- Contexto (sketch de Eduardo, confirmado por Xaviel):
--   Crear conduce = Origen ▼ → Destino ▼ → Materiales → Foto de Recepción
--   (el chofer RECIBE/carga el material del despachante) → Despachante ▼ →
--   Listo ⇒ "Pendiente entrega". Al emitir se firman DOS: el chofer
--   (rol 'transportista', AH4b) y el despachante (rol 'emisor'). La entrega al
--   receptor (foto + firma) sigue igual (AF13/AH6/AH7 — NO se toca).
--
-- Esta migración:
--   1) salidas_inventario += despachante (nombre libre + usuario/empleado opc.)
--      y carga_foto_path (foto de recepción del chofer al cargar).
--   2) crear_conduce_simple(...): envuelve crear_conduce_transportista (AF23,
--      auto-ruta intacta) y añade despachante + foto de carga + ambas firmas.
--   3) despachantes_disponibles(): universo del select (usuarios + empleados);
--      el origen ferretería/otros usa nombre libre (p_despachante_nombre).
--   4) mis_conduces_pendientes_entrega() + _count(): badge "Pendiente entrega".
--   Retrocompat: conduces viejos (sin despachante/carga_foto) se muestran igual.
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Columnas del despachante + foto de recepción (carga) ─────────────────
alter table sgc.salidas_inventario
  add column if not exists despachante_nombre      text,
  add column if not exists despachante_usuario_id  uuid references sgc.usuarios(id)  on delete set null,
  add column if not exists despachante_empleado_id uuid references sgc.empleados(id) on delete set null,
  add column if not exists carga_foto_path         text;

comment on column sgc.salidas_inventario.despachante_nombre      is 'AI2 — nombre de quien despacha/entrega el material al chofer (libre si es ferretería/otros).';
comment on column sgc.salidas_inventario.despachante_usuario_id  is 'AI2 — usuario despachante (si aplica).';
comment on column sgc.salidas_inventario.despachante_empleado_id is 'AI2 — empleado despachante (si aplica).';
comment on column sgc.salidas_inventario.carga_foto_path         is 'AI2 — foto de recepción del chofer al CARGAR el material del despachante (emisión). Distinta de recepcion_foto_path (confirmación del receptor).';

-- ── 2) Crear conduce simplificado (despachante + carga + doble firma) ───────
create or replace function sgc.crear_conduce_simple(
  p_id                     uuid,
  p_fecha                  date,
  p_bodega_id              uuid,
  p_proyecto_id            uuid,
  p_observaciones          text,
  p_vehiculo_id            uuid,
  p_ruta_id                uuid,
  p_items                  jsonb,
  p_despachante_nombre     text  default null,
  p_despachante_usuario_id uuid  default null,
  p_despachante_empleado_id uuid default null,
  p_carga_foto_path        text  default null,
  p_firma_chofer_path      text  default null,
  p_firma_despachante_path text  default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id            uuid;
  v_chofer_nombre text;
  v_desp_nombre   text;
begin
  -- Reutiliza el flujo AF23 (crea la salida + auto-ruta + parada). NO se duplica lógica.
  v_id := sgc.crear_conduce_transportista(
    p_id, p_fecha, p_bodega_id, p_proyecto_id, p_observaciones,
    p_vehiculo_id, p_ruta_id, p_items
  );

  update sgc.salidas_inventario set
    despachante_nombre      = nullif(p_despachante_nombre, ''),
    despachante_usuario_id  = p_despachante_usuario_id,
    despachante_empleado_id = p_despachante_empleado_id,
    carga_foto_path         = nullif(p_carga_foto_path, '')
  where id = v_id;

  -- Firma del chofer (transportista) — AH4b permite este rol.
  if nullif(p_firma_chofer_path, '') is not null then
    select nombre into v_chofer_nombre from sgc.usuarios where id = auth.uid();
    perform sgc.firmar_conduce(
      v_id, 'transportista', coalesce(nullif(v_chofer_nombre, ''), 'Chofer'),
      p_firma_chofer_path, null, 'Chofer', 'pad', auth.uid()
    );
  end if;

  -- Firma del despachante (emisor) — la segunda firma de emisión (refina AH4).
  if nullif(p_firma_despachante_path, '') is not null then
    v_desp_nombre := coalesce(
      nullif(p_despachante_nombre, ''),
      (select nombre from sgc.usuarios  where id = p_despachante_usuario_id),
      (select nombre from sgc.empleados where id = p_despachante_empleado_id),
      'Despachante'
    );
    perform sgc.firmar_conduce(
      v_id, 'emisor', v_desp_nombre,
      p_firma_despachante_path, null, 'Despachante', 'pad', p_despachante_usuario_id
    );
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.crear_conduce_simple(
  uuid, date, uuid, uuid, text, uuid, uuid, jsonb, text, uuid, uuid, text, text, text
) to authenticated, service_role;

-- ── 3) Universo del select "Despachante" ────────────────────────────────────
create or replace function sgc.despachantes_disponibles()
returns table (tipo text, id uuid, nombre text, detalle text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select 'usuario'::text, u.id, u.nombre, null::text
  from sgc.usuarios u
  where coalesce(u.activo, true)
  union all
  select 'empleado'::text, e.id, e.nombre, e.cargo
  from sgc.empleados e
  where coalesce(e.activo, true)
  order by 3;
$$;
grant execute on function sgc.despachantes_disponibles() to authenticated, service_role;

-- ── 4) Badge "Pendiente entrega" ────────────────────────────────────────────
create or replace function sgc.mis_conduces_pendientes_entrega()
returns table (
  id          uuid,
  fecha       date,
  proyecto_id uuid,
  destino     text,
  bodega      text,
  estado      text,
  fase        text,
  created_at  timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id, p.nombre, b.nombre, s.estado,
         sgc.conduce_fase(s.id), s.created_at
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  where (s.conductor_id in (select sgc.mis_conductor_ids()) or s.creado_por = auth.uid())
    and coalesce(s.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
    and s.recibido_por is null
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
  order by s.created_at desc;
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega() to authenticated, service_role;

create or replace function sgc.mis_conduces_pendientes_entrega_count()
returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int from sgc.mis_conduces_pendientes_entrega();
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega_count() to authenticated, service_role;
