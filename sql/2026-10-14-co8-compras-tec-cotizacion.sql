-- ============================================================================
-- CO8 — PROMPT-98 FASE 12 (14/10/2026): Compras tecnológicas
-- "i must be able to add a pdf(la cotizacion) and lets improve the way its
-- works and look" (#218).
--
-- `solicitudes_compra`/`solicitud_compra_items` son compartidas con el flujo
-- normal de Compras (requisición → compra); esta migración es ADITIVA (nuevos
-- estados, nuevas columnas nullable) y el flujo nuevo (borrador → esperando
-- aprobación → aprobada/rechazada → comprada) solo lo usan las RPCs de
-- `categoria='tecnologia'` de abajo — el flujo normal sigue igual
-- (pendiente/convertida/rechazada, intacto).
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) Estados nuevos (aditivo al CHECK existente) ──────────────────────────
alter table sgc.solicitudes_compra drop constraint if exists solicitudes_compra_estado_check;
alter table sgc.solicitudes_compra add constraint solicitudes_compra_estado_check
  check (estado = any (array['pendiente','convertida','rechazada','borrador','esperando_aprobacion','aprobada','comprada']));

alter table sgc.solicitudes_compra
  add column if not exists aprobador_id uuid references sgc.usuarios(id),
  add column if not exists enviada_at timestamptz,
  add column if not exists decidida_por uuid references sgc.usuarios(id),
  add column if not exists decidida_at timestamptz,
  add column if not exists motivo_rechazo text;

alter table sgc.solicitud_compra_items
  add column if not exists precio_unitario numeric;

-- ── 2) Adjuntos (cotizaciones) ───────────────────────────────────────────────
create table if not exists sgc.solicitud_compra_adjuntos (
  id          uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references sgc.solicitudes_compra(id) on delete cascade,
  tipo        text not null default 'cotizacion' check (tipo in ('cotizacion','factura','otro')),
  proveedor   text,
  monto       numeric,
  path        text not null,
  nombre      text not null,
  elegida     boolean not null default false,
  subido_por  uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_compra_adjuntos_solicitud on sgc.solicitud_compra_adjuntos (solicitud_id);

alter table sgc.solicitud_compra_adjuntos enable row level security;
drop policy if exists compra_adjuntos_select on sgc.solicitud_compra_adjuntos;
create policy compra_adjuntos_select on sgc.solicitud_compra_adjuntos
  for select to authenticated using (
    exists (select 1 from sgc.solicitudes_compra sc where sc.id = solicitud_id
      and (sc.solicitante_id = auth.uid() or sc.aprobador_id = auth.uid() or sgc.es_tecnologia()))
  );
grant select on sgc.solicitud_compra_adjuntos to authenticated;

-- ── 3) Bucket privado para las cotizaciones (PDF/imagen, 15 MB) ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compras-cotizaciones', 'compras-cotizaciones', false, 15728640,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "compras-cotizaciones: lectura de la propia o aprobador/tecnologia" on storage.objects;
create policy "compras-cotizaciones: lectura de la propia o aprobador/tecnologia" on storage.objects
  for select to authenticated using (
    bucket_id = 'compras-cotizaciones' and (
      sgc.es_tecnologia() or
      exists (
        select 1 from sgc.solicitud_compra_adjuntos a
        join sgc.solicitudes_compra sc on sc.id = a.solicitud_id
        where a.path = storage.objects.name
          and (sc.solicitante_id = auth.uid() or sc.aprobador_id = auth.uid())
      )
    )
  );
drop policy if exists "compras-cotizaciones: subida de usuarios de tecnologia" on storage.objects;
create policy "compras-cotizaciones: subida de usuarios de tecnologia" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'compras-cotizaciones' and (sgc.is_admin() or sgc.tiene_modulo('tecnologia'))
  );

-- ── 4) Parámetro: quién aprueba (Eduardo Ng por default) ────────────────────
insert into sgc.parametros (clave, valor) values ('compras_tec_aprobador', '')
on conflict (clave) do nothing;

-- ── 5) crear_solicitud_compra_tec — ahora nace en 'borrador' ────────────────
create or replace function sgc.crear_solicitud_compra_tec(p_notas text, p_items jsonb)
returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('tecnologia')) then
    raise exception 'No autorizado para crear compras tecnológicas.';
  end if;

  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, notas, categoria)
  values (null, auth.uid(), 'borrador', p_notas, 'tecnologia')
  returning id into v_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, foto_path, precio_unitario)
  select v_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido', i->>'foto_path',
         nullif(i->>'precio_unitario','')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  return v_id;
end;
$$;
grant execute on function sgc.crear_solicitud_compra_tec(text, jsonb) to authenticated;

-- ── 6) Flujo: enviar a aprobación ────────────────────────────────────────────
create or replace function sgc.compra_tec_enviar_aprobacion(p_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare
  v_sol sgc.solicitudes_compra%rowtype;
  v_aprobador_id uuid;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia' for update;
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if v_sol.estado <> 'borrador' then raise exception 'Esta compra ya fue enviada.'; end if;

  select nullif(valor,'')::uuid into v_aprobador_id from sgc.parametros where clave = 'compras_tec_aprobador';

  update sgc.solicitudes_compra
     set estado = 'esperando_aprobacion', enviada_at = now(), aprobador_id = v_aprobador_id
   where id = p_id;

  if v_aprobador_id is not null then
    perform sgc.notificar(v_aprobador_id, 'compra_tec', 'Compra tecnológica por aprobar',
      format('%s pidió una compra tecnológica — revisa la cotización.', coalesce((select nombre from sgc.usuarios where id = auth.uid()),'Un usuario')),
      '/tecnologia/compras?id=' || p_id::text);
  end if;
end;
$$;
grant execute on function sgc.compra_tec_enviar_aprobacion(uuid) to authenticated;

-- ── 7) Flujo: aprobar / rechazar ─────────────────────────────────────────────
create or replace function sgc.compra_tec_decidir(p_id uuid, p_aprobar boolean, p_motivo text default null)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol sgc.solicitudes_compra%rowtype;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia' for update;
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if not (sgc.is_admin() or auth.uid() = v_sol.aprobador_id) then
    raise exception 'Solo quien debe aprobarla puede decidir.' using errcode = '42501';
  end if;
  if v_sol.estado <> 'esperando_aprobacion' then raise exception 'Esta compra no está esperando aprobación.'; end if;
  if not p_aprobar and coalesce(trim(p_motivo),'') = '' then
    raise exception 'Escribe el motivo del rechazo.' using errcode = '22023';
  end if;

  update sgc.solicitudes_compra
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         decidida_por = auth.uid(), decidida_at = now(),
         motivo_rechazo = case when p_aprobar then null else p_motivo end
   where id = p_id;

  perform sgc.notificar(v_sol.solicitante_id, 'compra_tec',
    case when p_aprobar then 'Tu compra tecnológica fue aprobada' else 'Tu compra tecnológica fue rechazada' end,
    case when p_aprobar then 'Ya puedes proceder a comprar.' else coalesce('Motivo: ' || p_motivo, 'Sin motivo.') end,
    '/tecnologia/compras?id=' || p_id::text);
end;
$$;
grant execute on function sgc.compra_tec_decidir(uuid, boolean, text) to authenticated;

-- ── 8) Flujo: marcar comprada ────────────────────────────────────────────────
create or replace function sgc.compra_tec_marcar_comprada(p_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol sgc.solicitudes_compra%rowtype;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia' for update;
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if v_sol.estado <> 'aprobada' then raise exception 'Esta compra todavía no está aprobada.'; end if;
  update sgc.solicitudes_compra set estado = 'comprada' where id = p_id;
end;
$$;
grant execute on function sgc.compra_tec_marcar_comprada(uuid) to authenticated;

-- ── 9) Adjuntar / elegir cotización ──────────────────────────────────────────
create or replace function sgc.compra_tec_adjuntar_cotizacion(
  p_id uuid, p_tipo text, p_proveedor text, p_monto numeric, p_path text, p_nombre text
) returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol sgc.solicitudes_compra%rowtype; v_adj_id uuid; v_primera boolean;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia';
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  select not exists(select 1 from sgc.solicitud_compra_adjuntos where solicitud_id = p_id) into v_primera;
  insert into sgc.solicitud_compra_adjuntos (solicitud_id, tipo, proveedor, monto, path, nombre, subido_por, elegida)
  values (p_id, coalesce(nullif(p_tipo,''),'cotizacion'), p_proveedor, p_monto, p_path, p_nombre, auth.uid(), v_primera)
  returning id into v_adj_id;
  return v_adj_id;
end;
$$;
grant execute on function sgc.compra_tec_adjuntar_cotizacion(uuid, text, text, numeric, text, text) to authenticated;

create or replace function sgc.compra_tec_elegir_cotizacion(p_adjunto_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol_id uuid; v_sol sgc.solicitudes_compra%rowtype;
begin
  select solicitud_id into v_sol_id from sgc.solicitud_compra_adjuntos where id = p_adjunto_id;
  if v_sol_id is null then raise exception 'Cotización no encontrada.'; end if;
  select * into v_sol from sgc.solicitudes_compra where id = v_sol_id;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.solicitud_compra_adjuntos set elegida = (id = p_adjunto_id) where solicitud_id = v_sol_id;
end;
$$;
grant execute on function sgc.compra_tec_elegir_cotizacion(uuid) to authenticated;

commit;
