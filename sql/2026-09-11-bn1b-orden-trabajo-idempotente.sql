-- ============================================================================
-- BN1b — Orden de trabajo IDEMPOTENTE (11/09/2026)
-- ----------------------------------------------------------------------------
-- La app móvil (csd-app) escribe por un outbox que REINTENTA (ADR-002): si el
-- RPC hace COMMIT pero el 200 se pierde por señal de campo, el reintento crearía
-- una orden de trabajo DUPLICADA (con las firmas del cliente duplicadas).
--
-- crear_orden_trabajo generaba el id server-side (insert … returning id) y no
-- aceptaba un id de cliente. Este parche añade `p_id uuid default null` (client
-- UUID) y hace la creación idempotente: mismo p_id ⇒ no duplica.
--
-- Retrocompatible: la WEB llama sin p_id (named args) → p_id cae a null → el
-- servidor genera el id (comportamiento idéntico al anterior). Todo el RPC es una
-- sola transacción (plpgsql), así que un reintento encuentra la fila COMPLETA
-- (bitácora+detalle+firmas) o NADA — nunca estado parcial.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-11-bn1b-orden-trabajo-idempotente.sql
-- ============================================================================

begin;

-- Quitar la firma vieja (13 args) para evitar overload ambiguo; la nueva firma
-- (14 args, con p_id al final y default) cubre a la web (llama sin p_id) y a la app.
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

  -- Una orden de trabajo NO está completa sin las DOS firmas (regla de negocio en
  -- el servidor). El admin puede omitirlas (registro retroactivo).
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
  uuid, date, text, text, numeric, text, numeric, text, text, text, jsonb, jsonb, boolean, uuid
) to authenticated, service_role;

commit;
