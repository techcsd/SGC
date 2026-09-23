-- ============================================================================
-- BW1b (PROMPT-62 F2) — Avisos de Orden de trabajo (crear / compartir)
-- ----------------------------------------------------------------------------
-- (a) Registra los notif_tipo `orden_trabajo_creada` / `orden_trabajo_compartida`
--     (sin la fila, notificar(...) descarta el aviso).
-- (b) crear_orden_trabajo avisa al crear (regla 7: notificar_modulo → módulo
--     bitácora, respeta silencio; deep-link a la ficha).
-- (c) compartir_orden_trabajo(p_bitacora_id, p_usuarios[]) → aviso dirigido.
--
-- La redefinición de crear_orden_trabajo conserva EXACTA la lógica de BN1 y solo
-- agrega el bloque de aviso al final (envuelto en exception para no tumbar el alta).
-- ADITIVO. BU1 (regla 18): `--env dev` primero, luego `--env prod --yes`.
-- ============================================================================

begin;

-- ── 1) Tipos de aviso ────────────────────────────────────────────────────────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values
  ('orden_trabajo_creada', 'Nueva orden de trabajo',
   'Se registró una orden de trabajo en una obra.', true,
   array['in_app','push']::text[], true, 70),
  ('orden_trabajo_compartida', 'Orden de trabajo compartida',
   'Un usuario te compartió una orden de trabajo.', false,
   array['email','in_app','push']::text[], true, 71)
on conflict (tipo) do nothing;

-- ── 2) crear_orden_trabajo: + aviso al crear ─────────────────────────────────
-- OJO: la firma VIVA es la de BN1b (14 args, con p_id para idempotencia del outbox
-- de la app). La 13-arg fue DROPeada en BN1b; la web llama sin p_id (named args).
-- Redefinimos ESA (14-arg) para no reintroducir overload ambiguo. Por si acaso,
-- dejamos caer la 13-arg (idempotente).
drop function if exists sgc.crear_orden_trabajo(
  uuid, date, text, text, numeric, text, numeric, text, text, text, jsonb, jsonb, boolean
);

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
  p_comentarios    text default null,
  p_firma_ing      jsonb default null,
  p_firma_cli      jsonb default null,
  p_es_prueba      boolean default false,
  p_id             uuid default null              -- BN1b — client UUID (idempotencia app)
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid := coalesce(p_id, gen_random_uuid());  -- BN1b — id explícito idempotente
  v_es_prueba boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;
  if p_proyecto_id is null then raise exception 'Falta la obra'; end if;
  if coalesce(trim(p_descripcion), '') = '' then
    raise exception 'La descripción del trabajo es obligatoria';
  end if;

  if not sgc.is_admin() then
    if p_firma_ing is null or coalesce(trim(p_firma_ing->>'firma_path'), '') = '' then
      raise exception 'Falta la firma del ingeniero';
    end if;
    if p_firma_cli is null or coalesce(trim(p_firma_cli->>'firma_path'), '') = '' then
      raise exception 'Falta la firma del cliente';
    end if;
  end if;

  -- Cabecera con id EXPLÍCITO. BN1b — on conflict do nothing: un reintento del
  -- outbox con el mismo p_id NO duplica; devolvemos el id sin re-insertar hijas.
  insert into sgc.bitacoras (id, usuario_id, proyecto_id, fecha, tipo, comentarios, es_prueba)
  values (v_id, v_uid, p_proyecto_id, coalesce(p_fecha, current_date), 'orden_trabajo',
          nullif(trim(p_comentarios), ''), coalesce(p_es_prueba, false))
  on conflict (id) do nothing
  returning es_prueba into v_es_prueba;

  if not found then
    -- Ya existía (reintento idempotente): la orden completa está en la BD.
    return v_id;
  end if;

  insert into sgc.bitacora_orden_detalle (
    bitacora_id, descripcion, ubicacion, cantidad, unidad,
    monto_estimado, solicitado_por, notas, es_prueba
  ) values (
    v_id, trim(p_descripcion), nullif(trim(p_ubicacion), ''), p_cantidad,
    nullif(trim(p_unidad), ''), p_monto_estimado, nullif(trim(p_solicitado_por), ''),
    nullif(trim(p_notas), ''), v_es_prueba
  );

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

  -- BW1 — aviso al crear (regla 7). Solo en creación real (no en reintento idempotente,
  -- que retornó arriba) y no para órdenes de prueba. Deep-link a la ficha. No tumba el alta.
  if not coalesce(v_es_prueba, false) then
    begin
      perform sgc.notificar_modulo(
        'bitacora', 'orden_trabajo_creada',
        'Nueva orden de trabajo',
        coalesce((select p.nombre from sgc.proyectos p where p.id = p_proyecto_id), 'Obra')
          || ' · ' || left(trim(p_descripcion), 80),
        '/bitacora/orden-trabajo/' || v_id::text,
        v_id, 'bitacora_orden');
    exception when others then null;
    end;
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.crear_orden_trabajo(
  uuid, date, text, text, numeric, text, numeric, text, text, text, jsonb, jsonb, boolean, uuid
) to authenticated, service_role;

-- ── 3) compartir_orden_trabajo: aviso dirigido a usuarios elegidos ───────────
create or replace function sgc.compartir_orden_trabajo(
  p_bitacora_id uuid,
  p_usuarios    uuid[]
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_num  bigint;
  v_proy text;
  v_cod  text;
begin
  if not sgc.puede_ver_bitacora(p_bitacora_id) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_usuarios is null or array_length(p_usuarios, 1) is null then return; end if;

  select d.numero, p.nombre into v_num, v_proy
    from sgc.bitacoras b
    join sgc.bitacora_orden_detalle d on d.bitacora_id = b.id
    left join sgc.proyectos p on p.id = b.proyecto_id
   where b.id = p_bitacora_id and b.tipo = 'orden_trabajo';
  if not found then raise exception 'Orden de trabajo no encontrada.'; end if;

  v_cod := 'OT-' || lpad(coalesce(v_num, 0)::text, 6, '0');

  perform sgc.notificar_usuarios(
    p_usuarios, 'orden_trabajo_compartida',
    'Te compartieron una orden de trabajo',
    v_cod || coalesce(' · ' || v_proy, ''),
    '/bitacora/orden-trabajo/' || p_bitacora_id::text,
    p_bitacora_id, 'bitacora_orden');
end;
$function$;
grant execute on function sgc.compartir_orden_trabajo(uuid, uuid[]) to authenticated, service_role;

comment on function sgc.compartir_orden_trabajo(uuid, uuid[]) is
  'BW1 — comparte una orden de trabajo con usuarios del sistema (aviso orden_trabajo_compartida + deep-link a la ficha).';

commit;
