-- =============================================================================
-- PROMPT-5 FASE 2 (AM4) — Ronda 11/08/2026 (IDs AM). SGC padre.
-- 🔴 Transferencia de conduces "inconsistente en ambos lados": tras aceptar, al
--    emisor le sigue saliendo y al receptor no le aparece.
--
-- DIAGNÓSTICO (verificado contra prod con datos reales Eduardo NG ↔ Papo):
--   · AH5 (aceptar_transferencia_conduce) SÍ reasigna salidas_inventario.conductor_id
--     al receptor, atómicamente, en una sola transacción — está desplegado y
--     funciona (el conduce 37a55504 quedó con el portador correcto tras 3
--     transferencias de ida y vuelta hoy).
--   · AL13 (mis_conduces_pendientes_entrega) ya ancla la bandeja al PORTADOR
--     ACTUAL — desplegado. El emisor deja de verlo en cuanto conductor_id ≠ suyo.
--   ⇒ Server-side la transferencia ES atómica y consistente. El síntoma que queda
--     es de CACHE de la app (Dexie no se invalida) + realtime que no refresca a
--     ambos → se resuelve en PROMPT-6. AQUÍ blindamos el server para que NADA
--     pueda dejar el portador inconsistente y damos el contrato de realtime.
--
-- ESTE MIGRACIÓN (aditivo, retrocompatible):
--   1) GUARD del portador: `salidas_inventario` tiene policy UPDATE abierta a
--      authenticated. Si la app hiciera un PATCH con su copia vieja (conductor_id
--      del emisor), REVERTIRÍA el portador → exactamente el bug AM4. Un trigger
--      BEFORE UPDATE impide REASIGNAR el chofer salvo por la RPC de transferencia
--      (asignación inicial null→X permitida; reasignación X→Y solo vía RPC).
--   2) aceptar_transferencia_conduce: marca el flag de confianza + notifica
--      TAMBIÉN al receptor (contrato de refresco para su dispositivo) + push al
--      emisor (ya existía). El UPDATE de conductor_id ya emite postgres_changes
--      (salidas_inventario está en la publicación supabase_realtime).
--   3) reconciliar_portador_conduce() + barrido: sanea cualquier conduce cuyo
--      portador no coincida con la ÚLTIMA transferencia aceptada (idempotente).
-- =============================================================================

begin;

-- ── 1) GUARD: el portador (conductor_id) solo se reasigna vía RPC de transferencia ─
create or replace function sgc.tg_salidas_protege_portador()
returns trigger
language plpgsql
set search_path to 'sgc', 'pg_temp'
as $$
begin
  -- Solo protege la REASIGNACIÓN (de un chofer a otro). La asignación inicial
  -- (null → chofer) queda permitida para no romper flujos de alta/emisión.
  if old.conductor_id is not null
     and new.conductor_id is distinct from old.conductor_id
     and coalesce(current_setting('sgc.portador_ok', true), '') <> 'on' then
    -- Mantener el portador actual: un PATCH con copia vieja NO puede revertirlo.
    new.conductor_id := old.conductor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_salidas_protege_portador on sgc.salidas_inventario;
create trigger trg_salidas_protege_portador
  before update on sgc.salidas_inventario
  for each row execute function sgc.tg_salidas_protege_portador();

comment on function sgc.tg_salidas_protege_portador() is
  'AM4 — impide que un UPDATE directo (PATCH de la app con copia vieja) reasigne el chofer de un conduce; la reasignación X→Y solo se hace vía aceptar_transferencia_conduce (flag sgc.portador_ok=on). Cierra el hueco de la policy UPDATE abierta.';

-- ── 2) aceptar_transferencia_conduce: flag de confianza + avisar a AMBOS ──────
create or replace function sgc.aceptar_transferencia_conduce(
  p_transferencia_id uuid, p_foto_path text, p_firma_path text)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t sgc.conduce_transferencias%rowtype;
  v_salida sgc.salidas_inventario%rowtype;
  v_soy_destino boolean; v_ofrecio uuid; v_a_nombre text;
  v_receptor_usuario uuid; v_codigo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_t from sgc.conduce_transferencias where id = p_transferencia_id for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_t.estado <> 'ofrecida' then
    if v_t.estado = 'aceptada' and v_t.aceptada_por = v_uid then return v_t.id; end if; -- idempotente
    raise exception 'Esta transferencia ya fue resuelta';
  end if;

  v_soy_destino := exists (select 1 from sgc.conductores c
                           where c.id = v_t.a_conductor_id and c.usuario_id = v_uid);
  if not v_soy_destino then raise exception 'Solo el chofer destino puede aceptar la transferencia'; end if;

  -- AH6/AH7 — aceptar exige foto + firma del receptor.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de recepción es obligatoria para aceptar la transferencia';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma del receptor es obligatoria para aceptar la transferencia';
  end if;

  select * into v_salida from sgc.salidas_inventario where id = v_t.salida_id for update;

  update sgc.conduce_transferencias
     set estado = 'aceptada', aceptada_por = v_uid, foto_path = p_foto_path,
         firma_path = p_firma_path, resuelta_en = now()
   where id = p_transferencia_id;

  -- AM4 — habilitar el guard y reasignar atómicamente el conduce al nuevo chofer.
  perform set_config('sgc.portador_ok', 'on', true);
  update sgc.salidas_inventario set conductor_id = v_t.a_conductor_id where id = v_t.salida_id;

  -- Reasignar la RUTA vinculada (se conserva: paradas, tracking, historial).
  if v_salida.ruta_id is not null then
    update sgc.rutas set conductor_id = v_t.a_conductor_id, updated_at = now()
     where id = v_salida.ruta_id;
  end if;

  v_codigo := 'CND-' || upper(left(v_t.salida_id::text, 8));
  select nombre into v_a_nombre from sgc.usuarios where id = v_uid;

  -- Push al emisor de la oferta (o responsable anterior) — refresco de SU bandeja.
  v_ofrecio := coalesce(v_t.ofrecida_por,
                        (select usuario_id from sgc.conductores where id = v_t.de_conductor_id));
  if v_ofrecio is not null and v_ofrecio <> v_uid then
    perform sgc.notificar(v_ofrecio, 'transporte',
      'Transferencia de conduce aceptada',
      format('%s aceptó la responsabilidad del conduce %s. Ya no está en tu bandeja.',
             coalesce(v_a_nombre,'El chofer'), v_codigo),
      '/transporte/conduces');
  end if;

  -- AM4 — avisar TAMBIÉN al receptor (aunque sea quien aceptó) para forzar el
  -- refresco de su "Pendiente entrega" en su dispositivo.
  select usuario_id into v_receptor_usuario from sgc.conductores where id = v_t.a_conductor_id;
  if v_receptor_usuario is not null and v_receptor_usuario <> v_ofrecio then
    perform sgc.notificar(v_receptor_usuario, 'transporte',
      'Conduce a tu cargo',
      format('Aceptaste el conduce %s. Ya está en tu Pendiente entrega.', v_codigo),
      '/transporte/conduces');
  end if;

  return v_t.id;
end;
$function$;
grant execute on function sgc.aceptar_transferencia_conduce(uuid,text,text) to authenticated;

-- ── 3) Reconciliar el portador con la ÚLTIMA transferencia aceptada ──────────
-- Defensa/saneo: si por cualquier motivo histórico el portador quedó distinto de
-- la última transferencia aceptada, lo corrige (idempotente). Un solo conduce o
-- en barrido.
create or replace function sgc.reconciliar_portador_conduce(p_salida_id uuid)
returns boolean
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_ultimo uuid; v_actual uuid; v_ruta uuid;
begin
  select a_conductor_id into v_ultimo
    from sgc.conduce_transferencias
    where salida_id = p_salida_id and estado = 'aceptada'
    order by resuelta_en desc nulls last, ofrecida_en desc limit 1;
  if v_ultimo is null then return false; end if;   -- nunca se transfirió

  select conductor_id, ruta_id into v_actual, v_ruta
    from sgc.salidas_inventario where id = p_salida_id;
  if v_actual is not distinct from v_ultimo then return false; end if;

  perform set_config('sgc.portador_ok', 'on', true);
  update sgc.salidas_inventario set conductor_id = v_ultimo where id = p_salida_id;
  if v_ruta is not null then
    update sgc.rutas set conductor_id = v_ultimo, updated_at = now() where id = v_ruta;
  end if;
  return true;
end;
$$;
grant execute on function sgc.reconciliar_portador_conduce(uuid) to authenticated, service_role;
comment on function sgc.reconciliar_portador_conduce(uuid) is
  'AM4 — fija el portador del conduce a la última transferencia aceptada (saneo idempotente de estados inconsistentes).';

-- Barrido único de saneo (no toca nada si ya está consistente — como hoy en prod).
do $$
declare r record; n int := 0;
begin
  for r in
    select distinct t.salida_id
    from sgc.conduce_transferencias t
    where t.estado = 'aceptada'
  loop
    if sgc.reconciliar_portador_conduce(r.salida_id) then n := n + 1; end if;
  end loop;
  raise notice 'AM4 reconciliación: % conduce(s) saneado(s).', n;
end $$;

commit;
