-- ============================================================================
-- CC7 (PROMPT-74 F3) — "Outbox atascado": ver el conduce completo + la foto, y
-- reintentar en remoto. Nota #90: «i must be able to show the details of these
-- conduces and view the entire conduce, and the photo it has.»
-- ----------------------------------------------------------------------------
-- Contexto: los 5 atascados son `conduce confirmar` que fallaban por el CHECK
-- entradas_inventario_origen_tipo_chk (ya arreglado: incluye 'traslado_almacen').
-- Siguen atascados porque nadie los reintentó (la app solo reintenta transitorios).
-- La pantalla solo permitía "Marcar resuelto": ni ver el conduce ni la foto (que
-- puede vivir SOLO en el teléfono).
--
-- ADITIVO: columnas de estado de reintento/evidencia; tabla de evidencia subida
-- por la app; bucket privado; RPC de detalle (conduce por salida_id + payload
-- legible + evidencia); RPCs para pedir reintento / pedir evidencia (fijan sello
-- y devuelven a quién empujar — la web manda el push vía send-push).
--
-- BU1 (regla 18): --env dev primero, probar, luego --env prod --yes.
-- ============================================================================

begin;

-- ── 1) Estado de reintento / evidencia (aditivo) ─────────────────────────────
alter table sgc.outbox_atascados
  add column if not exists reintento_solicitado_en  timestamptz,
  add column if not exists reintento_solicitado_por uuid,
  add column if not exists evidencia_solicitada_en  timestamptz,
  add column if not exists evidencia_solicitada_por uuid;

-- ── 2) Evidencia (payload + fotos) que la app sube de un error de sistema ────
create table if not exists sgc.outbox_atascado_evidencia (
  id           uuid primary key default gen_random_uuid(),
  atascado_id  uuid references sgc.outbox_atascados(id) on delete cascade,
  salida_id    uuid,
  paths        text[] not null default '{}',
  subido_por   uuid,
  subido_en    timestamptz not null default now()
);
create index if not exists ix_outbox_evidencia_atascado on sgc.outbox_atascado_evidencia(atascado_id);
alter table sgc.outbox_atascado_evidencia enable row level security;

drop policy if exists outbox_evidencia_lee_tec on sgc.outbox_atascado_evidencia;
create policy outbox_evidencia_lee_tec on sgc.outbox_atascado_evidencia
  for select to authenticated using (sgc.es_tecnologia() or sgc.is_admin());
drop policy if exists outbox_evidencia_dueno_ins on sgc.outbox_atascado_evidencia;
create policy outbox_evidencia_dueno_ins on sgc.outbox_atascado_evidencia
  for insert to authenticated with check (subido_por = auth.uid());

-- CC8: la política SELECT `to authenticated` necesita su GRANT (si no, 403).
grant select, insert on sgc.outbox_atascado_evidencia to authenticated;

-- ── 3) Bucket privado para la evidencia ──────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('outbox-atascados', 'outbox-atascados', false)
on conflict (id) do nothing;

-- Lectura: Tecnología/admin. Escritura/borrado: el dueño en su carpeta (<uid>/...).
drop policy if exists "outbox-atascados lee tec" on storage.objects;
create policy "outbox-atascados lee tec" on storage.objects
  for select to authenticated
  using (bucket_id = 'outbox-atascados' and (sgc.es_tecnologia() or sgc.is_admin()));
drop policy if exists "outbox-atascados sube dueno" on storage.objects;
create policy "outbox-atascados sube dueno" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'outbox-atascados' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 4) Detalle del atascado: conduce completo + payload + evidencia ──────────
create or replace function sgc.outbox_atascado_detalle(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_row    sgc.outbox_atascados;
  v_salida uuid;
  v_result jsonb;
begin
  if not (sgc.es_tecnologia() or sgc.is_admin()) then
    raise exception 'Solo Tecnología.';
  end if;
  select * into v_row from sgc.outbox_atascados where id = p_id;
  if not found then raise exception 'Atascado no encontrado.'; end if;

  v_salida := nullif(v_row.payload_resumen ->> 'salida_id', '')::uuid;

  v_result := jsonb_build_object(
    'atascado', to_jsonb(v_row),
    'payload',  v_row.payload_resumen,
    'evidencia', coalesce((
      select jsonb_agg(jsonb_build_object('paths', ev.paths, 'subido_en', ev.subido_en) order by ev.subido_en desc)
      from sgc.outbox_atascado_evidencia ev where ev.atascado_id = p_id), '[]'::jsonb)
  );

  if v_salida is not null then
    v_result := v_result || jsonb_build_object('conduce', (
      select jsonb_build_object(
        'id', s.id,
        'codigo', 'C-' || substr(replace(s.id::text,'-',''),1,8),
        'fecha', s.fecha,
        'estado', s.estado,
        'origen', bo.nombre,
        'destino', coalesce(bd.nombre, s.destino_texto),
        'chofer', co.nombre,
        'vehiculo', trim(coalesce(v.alias,'') || ' ' || coalesce(v.placa,'')),
        'receptor', coalesce(s.entrega_receptor, s.notas_recepcion),
        'proyecto', p.nombre,
        'firma_path', s.entrega_firma_path,
        'foto_entrega', s.entrega_foto_path,
        'foto_recepcion', s.recepcion_foto_path,
        'foto_carga', s.carga_foto_path,
        'anulado', (s.anulado_en is not null),
        'renglones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'articulo', a.nombre,
            'enviado', d.cantidad,
            'recibido', d.cantidad_recibida,
            'unidad', d.unidad_capturada
          ) order by a.nombre)
          from sgc.detalle_salidas d
          left join sgc.articulos a on a.id = d.articulo_id
          where d.salida_id = s.id), '[]'::jsonb)
      )
      from sgc.salidas_inventario s
      left join sgc.bodegas bo on bo.id = s.bodega_id
      left join sgc.bodegas bd on bd.id = s.destino_almacen_id
      left join sgc.conductores co on co.id = s.conductor_id
      left join sgc.vehiculos v on v.id = s.vehiculo_id
      left join sgc.proyectos p on p.id = s.proyecto_id
      where s.id = v_salida
    ));
  end if;

  return v_result;
end;
$$;
grant execute on function sgc.outbox_atascado_detalle(uuid) to authenticated;

-- ── 5) Pedir reintento / pedir evidencia (fijan sello + devuelven destinatario) ─
create or replace function sgc.outbox_atascado_pedir_reintento(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_row sgc.outbox_atascados;
begin
  if not (sgc.es_tecnologia() or sgc.is_admin()) then raise exception 'Solo Tecnología.'; end if;
  update sgc.outbox_atascados
     set reintento_solicitado_en = now(), reintento_solicitado_por = auth.uid()
   where id = p_id returning * into v_row;
  if not found then raise exception 'Atascado no encontrado.'; end if;
  return jsonb_build_object(
    'usuario_id', v_row.usuario_id,
    'salida_id', v_row.payload_resumen ->> 'salida_id',
    'tipo_op', v_row.tipo_op);
end;
$$;
grant execute on function sgc.outbox_atascado_pedir_reintento(uuid) to authenticated;

create or replace function sgc.outbox_atascado_pedir_evidencia(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_row sgc.outbox_atascados;
begin
  if not (sgc.es_tecnologia() or sgc.is_admin()) then raise exception 'Solo Tecnología.'; end if;
  update sgc.outbox_atascados
     set evidencia_solicitada_en = now(), evidencia_solicitada_por = auth.uid()
   where id = p_id returning * into v_row;
  if not found then raise exception 'Atascado no encontrado.'; end if;
  return jsonb_build_object(
    'usuario_id', v_row.usuario_id,
    'usuario_nombre', v_row.usuario_nombre,
    'salida_id', v_row.payload_resumen ->> 'salida_id',
    'tipo_op', v_row.tipo_op);
end;
$$;
grant execute on function sgc.outbox_atascado_pedir_evidencia(uuid) to authenticated;

commit;
