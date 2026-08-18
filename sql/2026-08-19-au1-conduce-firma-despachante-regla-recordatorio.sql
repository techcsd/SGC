-- ============================================================================
-- PROMPT-21 (AU) — FASE 1 — Conduces: cerrar la brecha de la firma del
--   despachante (AU1). SGC padre. Aditivo / retrocompatible. Migración fechada.
-- ----------------------------------------------------------------------------
-- Contexto (CONTEXTO-ACTUALIZACION-10.md, caso real de Xaviel):
--   AS2 añadió la firma remota del despachante y la regla "sin firma no se marca
--   entregado" — PERO sólo en sgc.conduce_marcar_entregado (errcode DR456). El
--   cierre real del chofer en web/app pasa por sgc.entregar_conduce (AH6/AH7),
--   que NO tenía ese guard → el conduce de Xaviel (Papo como despachante) llegó a
--   "entregado" SIN la firma. Aquí:
--     (a) se aplica la MISMA regla server-side a entregar_conduce (transita sí,
--         entregar no, hasta que el despachante firme);
--     (b) se sanea el limbo: re-notifica al despachante de TODO conduce pendiente
--         de su firma (el de Xaviel incluido) para que aparezca/firme;
--     (c) recordatorio automático cada 2h hasta que firme (decisión de Xaviel).
--   La bandeja "Conduces por firmar" + badge (mis_conduces_por_firmar / _count) y
--   conduce_firmar_despachante YA existen (AS2); esta migración cierra la regla y
--   el recordatorio; el lado web se cablea aparte (salidas.service + página).
-- ============================================================================

set search_path = sgc, public;

-- ════════════════════════════════════════════════════════════════════════════
-- (a) entregar_conduce: aplicar el guard de firma del despachante (AS2 / DR456)
-- ════════════════════════════════════════════════════════════════════════════
-- Recrea AH6/AH7 conservando toda su lógica (foto + firma obligatorias, idempotencia,
-- incompleto) y añade el bloqueo por firma del despachante pendiente.
create or replace function sgc.entregar_conduce(p_salida_id uuid, p_items jsonb, p_receptor text, p_firma_url text, p_foto_url text, p_notas text default null)
returns text
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
  v_pendiente boolean;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotencia: un reenvío de quien ya entregó pasa en silencio.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    if v_salida.entregado_por = auth.uid() then return v_salida.estado; end if;
    raise exception 'Este conduce ya fue entregado.';
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor asignado a este conduce.';
  end if;

  -- AU1/AS2 — no se puede ENTREGAR sin la firma del despachante (transitar sí).
  -- Misma regla que conduce_marcar_entregado; cierra la brecha que dejó llegar el
  -- conduce de Xaviel a "entregado" sin la firma de Papo.
  if sgc.conduce_firma_despachante_pendiente(p_salida_id) then
    raise exception 'Falta la firma del despachante. No puedes marcar la entrega hasta que el despachante firme el conduce desde su sesión.'
      using errcode = 'DR456';
  end if;

  -- AH7 — foto de evidencia OBLIGATORIA en toda confirmación de entrega.
  if nullif(trim(coalesce(p_foto_url,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la entrega.';
  end if;
  -- AH6 — firma del receptor obligatoria, salvo entrega dejada pendiente/remota
  -- (receptor ausente: la firma del autorizado se aporta luego vía firmar_conduce).
  v_pendiente := (v_salida.firma_pendiente_usuario_id is not null)
                 or coalesce(v_salida.firma_pendiente_almacen, false);
  if nullif(trim(coalesce(p_firma_url,'')),'') is null and not v_pendiente then
    raise exception 'Falta la firma de recepción. Pide la firma o marca la entrega como pendiente (receptor ausente).';
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
    entregado_por = auth.uid(),
    entregado_en = now(),
    entrega_receptor = p_receptor,
    entrega_firma_path = p_firma_url,
    entrega_foto_path = p_foto_url,
    recibido_en = now(),
    notas_recepcion = coalesce(p_notas, notas_recepcion)
  where id = p_salida_id;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$function$;
grant execute on function sgc.entregar_conduce(uuid, jsonb, text, text, text, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (c) Recordatorio automático al despachante que no ha firmado (cada 2h)
-- ════════════════════════════════════════════════════════════════════════════
-- Re-push a cada despachante-usuario con conduces pendientes de su firma. Se salta
-- los recién creados (<90 min) para no duplicar el aviso de emisión (que ya avisó).
create or replace function sgc.recordar_conduces_por_firmar()
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  rec record;
  v_n int := 0;
begin
  for rec in
    select s.despachante_usuario_id as uid, count(*)::int as pendientes
      from sgc.salidas_inventario s
     where s.despachante_usuario_id is not null
       and coalesce(s.estado,'') <> 'anulado'
       and coalesce(s.es_prueba, false) = false
       and s.created_at < now() - interval '90 minutes'
       and not exists (select 1 from sgc.salida_firmas sf
                       where sf.salida_id = s.id and sf.rol = 'emisor')
     group by s.despachante_usuario_id
  loop
    perform sgc.notificar(
      rec.uid, 'conduce_firma',
      'Tienes '||rec.pendientes||' conduce'||(case when rec.pendientes = 1 then '' else 's' end)||' por firmar',
      'Aún no has firmado como despachante. Revísalo y fírmalo desde tu app para que el chofer pueda entregar.',
      '/transporte/por-firmar');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function sgc.recordar_conduces_por_firmar() to service_role;

comment on function sgc.recordar_conduces_por_firmar() is
  'AU1 — recordatorio cada 2h a los despachantes con conduces pendientes de su firma (decisión de Xaviel: recurrente hasta firmar).';

-- Cron: cada 2 horas en punto.
do $$ begin
  perform cron.schedule('sgc-recordar-firma-despachante', '0 */2 * * *',
    $cron$ select sgc.recordar_conduces_por_firmar(); $cron$);
exception when others then null; end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (b) Saneamiento del limbo: re-notificar TODO conduce pendiente de firma
-- ════════════════════════════════════════════════════════════════════════════
-- Incluye el conduce de Xaviel que llegó a "entregado" sin la firma de Papo. No se
-- revierte la entrega (no destructivo); el conduce sigue apareciendo en la bandeja
-- "Conduces por firmar" del despachante (mis_conduces_por_firmar no filtra estado)
-- y conduce_firmar_despachante permite firmarlo aunque ya esté entregado.
do $$
declare rec record;
begin
  for rec in
    select s.id, s.despachante_usuario_id as uid
      from sgc.salidas_inventario s
     where s.despachante_usuario_id is not null
       and coalesce(s.estado,'') <> 'anulado'
       and coalesce(s.es_prueba, false) = false
       and not exists (select 1 from sgc.salida_firmas sf
                       where sf.salida_id = s.id and sf.rol = 'emisor')
  loop
    perform sgc.notificar(
      rec.uid, 'conduce_firma',
      'Conduce por firmar',
      'Tienes un conduce pendiente de tu firma como despachante. Fírmalo desde tu app.',
      '/transporte/por-firmar');
  end loop;
end $$;
