-- =============================================================================
-- PROMPT-9 FASE 4 (AH4, AH5) — Conduces: segunda firma al emitir + transferencia
-- de responsabilidad entre choferes. Aditivo y retrocompatible.
--
--  AH4 — Al emitir un conduce firman DOS: quien entrega (emisor) y el chofer que
--        transporta (transportista). Cuando el chofer crea el conduce solo, es la
--        misma persona → una firma con doble rol (la UI decide; el modelo admite
--        ambas). Se añade el rol 'transportista' a salida_firmas.
--
--  AH5 — Un chofer puede transferir la RESPONSABILIDAD de un conduce a otro chofer.
--        El responsable actual (o jefe de flota — asunción J) OFRECE a un chofer
--        destino; éste ACEPTA con foto + firma (proceso corto). Hasta aceptar, la
--        responsabilidad NO cambia. Un conduce puede transferirse N veces
--        (historial completo). Al aceptar: se reasigna el conduce y su ruta
--        vinculada al nuevo chofer (se REASIGNA, no se regenera: conserva paradas,
--        tracking e historial de la ruta). Push al receptor al ofrecer y al emisor
--        al aceptar.
-- =============================================================================

begin;

-- ── AH4 — tercer rol de firma: transportista ────────────────────────────────
alter table sgc.salida_firmas drop constraint if exists salida_firmas_rol_check;
alter table sgc.salida_firmas add constraint salida_firmas_rol_check
  check (rol = any (array['emisor','receptor','transportista']));

-- ── AH5 — modelo de transferencia de responsabilidad ────────────────────────
create table if not exists sgc.conduce_transferencias (
  id              uuid primary key default gen_random_uuid(),
  salida_id       uuid not null references sgc.salidas_inventario(id) on delete cascade,
  de_conductor_id uuid references sgc.conductores(id),
  a_conductor_id  uuid not null references sgc.conductores(id),
  ofrecida_por    uuid,   -- auth.uid() de quien ofrece
  aceptada_por    uuid,   -- auth.uid() del receptor al aceptar
  estado          text not null default 'ofrecida'
                    check (estado in ('ofrecida','aceptada','rechazada','cancelada')),
  foto_path       text,   -- evidencia del receptor al aceptar (AH6/AH7)
  firma_path      text,   -- firma del receptor al aceptar
  notas           text,
  ofrecida_en     timestamptz not null default now(),
  resuelta_en     timestamptz,
  es_prueba       boolean not null default false,
  es_prueba_origen text
);
create index if not exists idx_conduce_transf_salida on sgc.conduce_transferencias(salida_id);
create index if not exists idx_conduce_transf_dest on sgc.conduce_transferencias(a_conductor_id) where estado = 'ofrecida';

alter table sgc.conduce_transferencias enable row level security;

-- Lectura: partes involucradas, flota elevado, admin.
drop policy if exists conduce_transf_sel on sgc.conduce_transferencias;
create policy conduce_transf_sel on sgc.conduce_transferencias
  for select to authenticated
  using (
    sgc.is_admin() or sgc.es_flota_elevado()
    or de_conductor_id in (select sgc.mis_conductor_ids())
    or a_conductor_id  in (select sgc.mis_conductor_ids())
  );
-- Escritura solo por RPC (SECURITY DEFINER); sin policies de insert/update directas.

-- Ocultar transferencias de prueba a no-admin.
drop policy if exists "conduce_transf es_prueba" on sgc.conduce_transferencias;
create policy "conduce_transf es_prueba" on sgc.conduce_transferencias
  as restrictive
  for select to authenticated
  using ((not es_prueba) or sgc.is_admin());

-- ── RPC: ofrecer transferencia ──────────────────────────────────────────────
create or replace function sgc.ofrecer_transferencia_conduce(
  p_salida_id uuid, p_a_conductor_id uuid, p_notas text default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_salida sgc.salidas_inventario%rowtype;
  v_es_flota boolean := sgc.is_admin() or sgc.es_flota_elevado();
  v_soy_responsable boolean;
  v_a_usuario uuid; v_de_nombre text; v_id uuid; v_es_prueba boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado'; end if;

  -- Solo el responsable actual (chofer del conduce) o flota/admin pueden ofrecer.
  v_soy_responsable := exists (
    select 1 from sgc.conductores c
    where c.id = v_salida.conductor_id and c.usuario_id = v_uid);
  if not (v_soy_responsable or v_es_flota) then
    raise exception 'Solo el chofer responsable o Flota puede transferir este conduce';
  end if;

  if p_a_conductor_id = v_salida.conductor_id then
    raise exception 'El conduce ya está a cargo de ese chofer';
  end if;
  if not exists (select 1 from sgc.conductores where id = p_a_conductor_id and coalesce(activo,true)) then
    raise exception 'Chofer destino no válido';
  end if;

  -- Una sola oferta activa por conduce.
  if exists (select 1 from sgc.conduce_transferencias
             where salida_id = p_salida_id and estado = 'ofrecida') then
    raise exception 'Ya hay una transferencia pendiente para este conduce';
  end if;

  v_es_prueba := coalesce(v_salida.es_prueba, false);
  insert into sgc.conduce_transferencias (
    salida_id, de_conductor_id, a_conductor_id, ofrecida_por, notas, es_prueba, es_prueba_origen)
  values (p_salida_id, v_salida.conductor_id, p_a_conductor_id, v_uid, nullif(trim(p_notas),''),
          v_es_prueba, case when v_es_prueba then 'heredado' else 'manual' end)
  returning id into v_id;

  -- Push AF7 al chofer receptor.
  select usuario_id into v_a_usuario from sgc.conductores where id = p_a_conductor_id;
  select nombre into v_de_nombre from sgc.usuarios where id = v_uid;
  if v_a_usuario is not null then
    perform sgc.notificar(v_a_usuario, 'transporte',
      'Te ofrecen un conduce',
      format('%s quiere transferirte la responsabilidad de un conduce. Revísalo y acéptalo con foto y firma.',
             coalesce(v_de_nombre,'Un chofer')),
      '/transporte/conduces');
  end if;

  return v_id;
end;
$function$;

-- ── RPC: aceptar transferencia (exige foto + firma) ─────────────────────────
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

  -- Marcar aceptada.
  update sgc.conduce_transferencias
     set estado = 'aceptada', aceptada_por = v_uid, foto_path = p_foto_path,
         firma_path = p_firma_path, resuelta_en = now()
   where id = p_transferencia_id;

  -- Reasignar el conduce al nuevo chofer.
  update sgc.salidas_inventario set conductor_id = v_t.a_conductor_id where id = v_t.salida_id;

  -- Reasignar la RUTA vinculada (se conserva: paradas, tracking, historial).
  if v_salida.ruta_id is not null then
    update sgc.rutas set conductor_id = v_t.a_conductor_id, updated_at = now()
     where id = v_salida.ruta_id;
  end if;

  -- Push al emisor de la oferta (o al responsable anterior).
  v_ofrecio := coalesce(v_t.ofrecida_por,
                        (select usuario_id from sgc.conductores where id = v_t.de_conductor_id));
  select nombre into v_a_nombre from sgc.usuarios where id = v_uid;
  if v_ofrecio is not null and v_ofrecio <> v_uid then
    perform sgc.notificar(v_ofrecio, 'transporte',
      'Transferencia de conduce aceptada',
      format('%s aceptó la responsabilidad del conduce que le transferiste.', coalesce(v_a_nombre,'El chofer')),
      '/transporte/conduces');
  end if;

  return v_t.id;
end;
$function$;

-- ── RPC: rechazar / cancelar transferencia ──────────────────────────────────
create or replace function sgc.rechazar_transferencia_conduce(
  p_transferencia_id uuid, p_motivo text default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t sgc.conduce_transferencias%rowtype;
  v_soy_destino boolean; v_soy_emisor boolean; v_nuevo_estado text; v_avisar uuid; v_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_t from sgc.conduce_transferencias where id = p_transferencia_id for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_t.estado <> 'ofrecida' then
    if v_t.estado in ('rechazada','cancelada') then return v_t.id; end if; -- idempotente
    raise exception 'Esta transferencia ya fue resuelta';
  end if;

  v_soy_destino := exists (select 1 from sgc.conductores c where c.id = v_t.a_conductor_id and c.usuario_id = v_uid);
  v_soy_emisor  := (v_t.ofrecida_por = v_uid) or sgc.is_admin() or sgc.es_flota_elevado();
  if not (v_soy_destino or v_soy_emisor) then
    raise exception 'No puedes resolver esta transferencia';
  end if;

  -- Receptor rechaza; emisor/flota cancela.
  v_nuevo_estado := case when v_soy_destino then 'rechazada' else 'cancelada' end;
  update sgc.conduce_transferencias
     set estado = v_nuevo_estado, resuelta_en = now(), notas = coalesce(nullif(trim(p_motivo),''), notas)
   where id = p_transferencia_id;

  -- Avisar a la otra parte.
  select nombre into v_nombre from sgc.usuarios where id = v_uid;
  if v_soy_destino then
    v_avisar := coalesce(v_t.ofrecida_por, (select usuario_id from sgc.conductores where id = v_t.de_conductor_id));
  else
    v_avisar := (select usuario_id from sgc.conductores where id = v_t.a_conductor_id);
  end if;
  if v_avisar is not null and v_avisar <> v_uid then
    perform sgc.notificar(v_avisar, 'transporte',
      case when v_soy_destino then 'Transferencia rechazada' else 'Transferencia cancelada' end,
      format('%s %s la transferencia del conduce.', coalesce(v_nombre,'El chofer'),
             case when v_soy_destino then 'rechazó' else 'canceló' end),
      '/transporte/conduces');
  end if;

  return v_t.id;
end;
$function$;

grant execute on function sgc.ofrecer_transferencia_conduce(uuid,uuid,text) to authenticated;
grant execute on function sgc.aceptar_transferencia_conduce(uuid,text,text) to authenticated;
grant execute on function sgc.rechazar_transferencia_conduce(uuid,text) to authenticated;
grant select on sgc.conduce_transferencias to authenticated;

commit;
