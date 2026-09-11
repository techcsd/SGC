-- ============================================================================
-- BN1 — Orden de trabajo (09/09/2026)
-- ----------------------------------------------------------------------------
-- Nuevo tipo de bitácora `orden_trabajo`: el ingeniero levanta en obra un trabajo
-- pedido por el cliente (descripción/ubicación/monto estimado) con DOS firmas
-- capturadas en el mismo dispositivo (ingeniero + cliente) y PDF/impresión.
--
-- §G-1 (verificado en prod 09/09): NO se tocan NOT NULL ni se usan centinelas.
--   Las columnas del parte diario que la orden no tiene o ya son nullables
--   (bloque_entrepiso/ingeniero_responsable/hora_fin_trabajo desde bitacora-tipos)
--   o tienen DEFAULT 0 (personal_carpinteria/personal_acero/trabajadores_casa).
--   Las únicas NOT NULL sin default son usuario_id/proyecto_id/fecha, que la orden
--   sí tiene. El RPC simplemente OMITE las columnas del parte diario.
-- §G-2: monto_estimado es sólo registro/exportable — NO hay facturación (confirmado).
--
-- Reglas del checklist aplicadas: (1) RLS por rol vía puede_ver_bitacora; (3) CHECK
-- ampliado con nombre en la misma migración (aditivo); (5) RPC SECURITY DEFINER +
-- grant a authenticated; firmas = molde de salida_firmas (AC7).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-09-bn1-orden-de-trabajo.sql
-- ============================================================================

begin;

-- ── 1) Dominio de `tipo`: ampliar el CHECK (con nombre explícito) ────────────
alter table sgc.bitacoras drop constraint if exists bitacoras_tipo_check;
alter table sgc.bitacoras add constraint bitacoras_tipo_check
  check (tipo in ('parte_diario', 'visita', 'incidente', 'orden_trabajo'));

-- ── 2) Detalle de la orden (tabla hija; un renglón por orden en v1) ──────────
create table if not exists sgc.bitacora_orden_detalle (
  id             uuid primary key default gen_random_uuid(),
  bitacora_id    uuid not null references sgc.bitacoras(id) on delete cascade,
  descripcion    text not null,                 -- qué trabajo se pidió/hizo
  ubicacion      text,                          -- dónde dentro de la obra
  cantidad       numeric,
  unidad         text,
  monto_estimado numeric,                        -- §G-2: sólo registro, NO factura
  solicitado_por text,                           -- nombre del lado del cliente
  notas          text,
  es_prueba      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (bitacora_id)                            -- un detalle por orden
);
create index if not exists idx_orden_detalle_bitacora on sgc.bitacora_orden_detalle(bitacora_id);

-- ── 3) Firmas de la orden (molde exacto de salida_firmas, AC7) ───────────────
create table if not exists sgc.bitacora_orden_firmas (
  id           uuid primary key default gen_random_uuid(),
  bitacora_id  uuid not null references sgc.bitacoras(id) on delete cascade,
  rol          text not null check (rol in ('ingeniero', 'cliente')),
  nombre       text not null,                     -- se estampa en el PDF
  cedula       text,                              -- opcional (cliente puede no darla)
  rol_desc     text,                              -- "Ing. residente", "Propietario"…
  usuario_id   uuid references sgc.usuarios(id),  -- sólo el ingeniero lo tendrá
  firma_path   text not null,                     -- PNG en bucket sgc-bitacora
  metodo       text not null default 'pad' check (metodo in ('pad', 'foto')),
  firmado_en   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (bitacora_id, rol)                        -- una firma por rol
);
create index if not exists idx_orden_firmas_bitacora on sgc.bitacora_orden_firmas(bitacora_id);

-- ── 4) RLS de las hijas: mismo alcance que la bitácora padre ─────────────────
alter table sgc.bitacora_orden_detalle enable row level security;
drop policy if exists orden_detalle_sel on sgc.bitacora_orden_detalle;
create policy orden_detalle_sel on sgc.bitacora_orden_detalle for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id));
-- La escritura va SÓLO por el RPC (SECURITY DEFINER); sin policy de INSERT directo.

alter table sgc.bitacora_orden_firmas enable row level security;
drop policy if exists orden_firmas_sel on sgc.bitacora_orden_firmas;
create policy orden_firmas_sel on sgc.bitacora_orden_firmas for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id));

comment on table sgc.bitacora_orden_detalle is
  'BN1 — detalle de la orden de trabajo (bitácora tipo orden_trabajo). Monto = sólo registro (§G-2).';
comment on table sgc.bitacora_orden_firmas is
  'BN1 — firmas de la orden de trabajo (ingeniero + cliente). PNG en bucket sgc-bitacora (firma_path).';

-- ── 5) RPC de creación: valida las DOS firmas en el servidor ─────────────────
create or replace function sgc.crear_orden_trabajo(
  p_proyecto_id    uuid,
  p_fecha          date,
  p_descripcion    text,
  p_ubicacion      text default null,
  p_cantidad       numeric default null,
  p_unidad         text default null,
  p_monto_estimado numeric default null,
  p_solicitado_por text default null,
  p_notas          text default null,
  p_comentarios    text default null,             -- texto general de la bitácora
  p_firma_ing      jsonb default null,            -- {nombre, cedula, rol_desc, firma_path, metodo}
  p_firma_cli      jsonb default null,
  p_es_prueba      boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_es_prueba boolean;
begin
  -- Gate por matriz (paridad con crear_entrada_bitacora). SECURITY DEFINER
  -- bypassea la RLS, así que el acceso se valida aquí.
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;
  if p_proyecto_id is null then raise exception 'Falta la obra'; end if;
  if coalesce(trim(p_descripcion), '') = '' then
    raise exception 'La descripción del trabajo es obligatoria';
  end if;

  -- 🔴 Una orden de trabajo NO está completa sin las DOS firmas (regla de negocio
  -- en el servidor, no sólo en el formulario). El admin puede omitirlas (registro
  -- retroactivo), como recepción (ay2/bd2b).
  if not sgc.is_admin() then
    if p_firma_ing is null or coalesce(trim(p_firma_ing->>'firma_path'), '') = '' then
      raise exception 'Falta la firma del ingeniero';
    end if;
    if p_firma_cli is null or coalesce(trim(p_firma_cli->>'firma_path'), '') = '' then
      raise exception 'Falta la firma del cliente';
    end if;
  end if;

  -- Cabecera: bitácora tipo orden_trabajo. Omite columnas del parte diario
  -- (contadores caen a 0 por default; nullables quedan null). El trigger
  -- trg_heredar_es_prueba coalescea es_prueba desde la obra.
  insert into sgc.bitacoras (usuario_id, proyecto_id, fecha, tipo, comentarios, es_prueba)
  values (v_uid, p_proyecto_id, coalesce(p_fecha, current_date), 'orden_trabajo',
          nullif(trim(p_comentarios), ''), coalesce(p_es_prueba, false))
  returning id, es_prueba into v_id, v_es_prueba;

  -- Detalle
  insert into sgc.bitacora_orden_detalle (
    bitacora_id, descripcion, ubicacion, cantidad, unidad,
    monto_estimado, solicitado_por, notas, es_prueba
  ) values (
    v_id, trim(p_descripcion), nullif(trim(p_ubicacion), ''), p_cantidad,
    nullif(trim(p_unidad), ''), p_monto_estimado, nullif(trim(p_solicitado_por), ''),
    nullif(trim(p_notas), ''), v_es_prueba
  );

  -- Firmas (una por rol). Si vienen null (admin), no se insertan.
  if p_firma_ing is not null and coalesce(trim(p_firma_ing->>'firma_path'), '') <> '' then
    insert into sgc.bitacora_orden_firmas (bitacora_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
    values (v_id, 'ingeniero',
            coalesce(nullif(trim(p_firma_ing->>'nombre'), ''), 'Ingeniero'),
            nullif(trim(p_firma_ing->>'cedula'), ''),
            nullif(trim(p_firma_ing->>'rol_desc'), ''),
            v_uid,
            trim(p_firma_ing->>'firma_path'),
            coalesce(nullif(p_firma_ing->>'metodo', ''), 'pad'));
  end if;
  if p_firma_cli is not null and coalesce(trim(p_firma_cli->>'firma_path'), '') <> '' then
    insert into sgc.bitacora_orden_firmas (bitacora_id, rol, nombre, cedula, rol_desc, firma_path, metodo)
    values (v_id, 'cliente',
            coalesce(nullif(trim(p_firma_cli->>'nombre'), ''), 'Cliente'),
            nullif(trim(p_firma_cli->>'cedula'), ''),
            nullif(trim(p_firma_cli->>'rol_desc'), ''),
            trim(p_firma_cli->>'firma_path'),
            coalesce(nullif(p_firma_cli->>'metodo', ''), 'pad'));
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.crear_orden_trabajo(
  uuid, date, text, text, numeric, text, numeric, text, text, text, jsonb, jsonb, boolean
) to authenticated, service_role;

-- ── 6) RPC de lectura: detalle + firmas de una orden (para ficha/impresión) ──
create or replace function sgc.orden_trabajo_detalle(p_bitacora_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select case when not sgc.puede_ver_bitacora(p_bitacora_id) then null else
    jsonb_build_object(
      'bitacora', (
        select jsonb_build_object(
          'id', b.id, 'fecha', b.fecha, 'comentarios', b.comentarios,
          'proyecto_id', b.proyecto_id, 'proyecto', p.nombre,
          'usuario_id', b.usuario_id, 'autor', u.nombre,
          'created_at', b.created_at, 'es_prueba', b.es_prueba)
        from sgc.bitacoras b
        left join sgc.proyectos p on p.id = b.proyecto_id
        left join sgc.usuarios u on u.id = b.usuario_id
        where b.id = p_bitacora_id
      ),
      'detalle', (
        select to_jsonb(d) from sgc.bitacora_orden_detalle d where d.bitacora_id = p_bitacora_id
      ),
      'firmas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rol', f.rol, 'nombre', f.nombre, 'cedula', f.cedula,
          'rol_desc', f.rol_desc, 'firma_path', f.firma_path,
          'metodo', f.metodo, 'firmado_en', f.firmado_en) order by f.rol)
        from sgc.bitacora_orden_firmas f where f.bitacora_id = p_bitacora_id
      ), '[]'::jsonb)
    )
  end;
$function$;
grant execute on function sgc.orden_trabajo_detalle(uuid) to authenticated, service_role;

commit;
