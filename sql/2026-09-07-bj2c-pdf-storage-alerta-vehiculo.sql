-- ============================================================================
-- BJ2 (parte c) — Cierre de follow-ups de la conciliación por PDF:
--   (1) Guardar el PDF original ligado a la conciliación (traza fiscal: e-NCF,
--       firma, CodigoSeguridad). Bucket privado sgc-combustible + pdf_path.
--   (2) Persistir la columna Alerta (FR/H/J/X/Y/Z) — control de consumo fuera de
--       política. Hoy no se guardaba.
--   (3) Persistir el vehiculo_id resuelto por el mapeo de tarjeta (ya existía la
--       columna; el import ahora lo manda).
--
-- Aditivo/idempotente. Reglas del checklist: (7) bucket con upsert:true nace con
-- política INSERT *y* UPDATE.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- (2) Columna Alerta en las transacciones del proveedor.
alter table sgc.combustible_transacciones_proveedor
  add column if not exists alerta text;
comment on column sgc.combustible_transacciones_proveedor.alerta is
  'BJ2 — código(s) de alerta de la factura (FR frecuencia, H horario, J días, X kilometraje, Y >1 transacción/día, Z zona). Consumo fuera de política.';

-- (1) Columna pdf_path en la conciliación.
alter table sgc.conciliaciones_combustible
  add column if not exists pdf_path text;

-- (2)+(3) Recrear el import para insertar alerta (y el vehiculo_id ya soportado).
create or replace function sgc.importar_transacciones_combustible(p_transacciones jsonb)
returns int
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_n int;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then raise exception 'Sin permiso'; end if;
  with ins as (
    insert into sgc.combustible_transacciones_proveedor (
      transaccion_num, numero_factura, fecha_factura, fecha_vencimiento, total_factura,
      fecha, hora, numero_tarjeta, numero_registro, titular, titular_es_persona,
      kilometraje, estacion_codigo, estacion_ubicacion, producto, galones,
      precio_unitario, importe, ncf, trans_status, vehiculo_id, alerta)
    select
      t->>'transaccion_num', t->>'numero_factura', nullif(t->>'fecha_factura','')::date,
      nullif(t->>'fecha_vencimiento','')::date, nullif(t->>'total_factura','')::numeric,
      nullif(t->>'fecha','')::date, t->>'hora', t->>'numero_tarjeta', t->>'numero_registro',
      t->>'titular', coalesce((t->>'titular_es_persona')::boolean,false),
      nullif(t->>'kilometraje','')::numeric, t->>'estacion_codigo', t->>'estacion_ubicacion',
      t->>'producto', nullif(t->>'galones','')::numeric, nullif(t->>'precio_unitario','')::numeric,
      nullif(t->>'importe','')::numeric, t->>'ncf', t->>'trans_status',
      nullif(t->>'vehiculo_id','')::uuid, nullif(t->>'alerta','')
    from jsonb_array_elements(coalesce(p_transacciones,'[]'::jsonb)) as t
    where t->>'transaccion_num' is not null
    on conflict (transaccion_num) do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end;
$function$;
grant execute on function sgc.importar_transacciones_combustible(jsonb) to authenticated, service_role;

-- (1) Recrear guardar para almacenar pdf_path (del meta). Resto idéntico.
create or replace function sgc.guardar_conciliacion_combustible(p_meta jsonb, p_detalles jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_id uuid;
  v_discrepancias int;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado para guardar conciliaciones de combustible.';
  end if;

  insert into sgc.conciliaciones_combustible (
    estacion, fecha_desde, fecha_hasta, nombre_archivo,
    total_informe_filas, total_matches, total_solo_plataforma, total_solo_informe, total_diferencias,
    monto_plataforma, monto_informe, galones_plataforma, galones_informe, notas, pdf_path, creado_por
  ) values (
    coalesce(p_meta->>'estacion','Total Energies'),
    nullif(p_meta->>'fecha_desde','')::date, nullif(p_meta->>'fecha_hasta','')::date,
    p_meta->>'nombre_archivo',
    coalesce((p_meta->>'total_informe_filas')::int,0),
    coalesce((p_meta->>'total_matches')::int,0),
    coalesce((p_meta->>'total_solo_plataforma')::int,0),
    coalesce((p_meta->>'total_solo_informe')::int,0),
    coalesce((p_meta->>'total_diferencias')::int,0),
    coalesce((p_meta->>'monto_plataforma')::numeric,0),
    coalesce((p_meta->>'monto_informe')::numeric,0),
    coalesce((p_meta->>'galones_plataforma')::numeric,0),
    coalesce((p_meta->>'galones_informe')::numeric,0),
    p_meta->>'notas', nullif(p_meta->>'pdf_path',''), auth.uid()
  ) returning id into v_id;

  insert into sgc.conciliacion_combustible_detalle (
    conciliacion_id, tipo, registro_id, vehiculo_id, identificador, fecha,
    galones_plataforma, galones_informe, monto_plataforma, monto_informe,
    diferencia_galones, diferencia_monto
  )
  select v_id, d->>'tipo',
         nullif(d->>'registro_id','')::uuid, nullif(d->>'vehiculo_id','')::uuid,
         d->>'identificador', nullif(d->>'fecha','')::date,
         nullif(d->>'galones_plataforma','')::numeric, nullif(d->>'galones_informe','')::numeric,
         nullif(d->>'monto_plataforma','')::numeric, nullif(d->>'monto_informe','')::numeric,
         nullif(d->>'diferencia_galones','')::numeric, nullif(d->>'diferencia_monto','')::numeric
  from jsonb_array_elements(p_detalles) as d;

  v_discrepancias := coalesce((p_meta->>'total_diferencias')::int,0)
                   + coalesce((p_meta->>'total_solo_plataforma')::int,0)
                   + coalesce((p_meta->>'total_solo_informe')::int,0);

  if v_discrepancias > 0 then
    insert into sgc.avisos_flota (tipo, mensaje, severidad, dedup_key)
    values ('conciliacion',
            format('Conciliación de combustible %s: %s discrepancia(s) detectada(s).',
                   coalesce(p_meta->>'estacion','Total Energies'), v_discrepancias),
            'alta', 'conciliacion:' || v_id::text)
    on conflict (dedup_key) do nothing;
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.guardar_conciliacion_combustible(jsonb, jsonb) to authenticated, service_role;

-- (1) Bucket privado para los PDF de factura + políticas (regla 7: upsert ⇒ INSERT y UPDATE).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sgc-combustible', 'sgc-combustible', false, 27262976, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "sgc-combustible: select" on storage.objects;
create policy "sgc-combustible: select" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-combustible' and (sgc.is_admin() or sgc.es_flota_elevado()));

drop policy if exists "sgc-combustible: insert" on storage.objects;
create policy "sgc-combustible: insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-combustible' and (sgc.is_admin() or sgc.es_flota_elevado()));

drop policy if exists "sgc-combustible: update" on storage.objects;
create policy "sgc-combustible: update" on storage.objects for update to authenticated
  using (bucket_id = 'sgc-combustible' and (sgc.is_admin() or sgc.es_flota_elevado()))
  with check (bucket_id = 'sgc-combustible' and (sgc.is_admin() or sgc.es_flota_elevado()));

commit;
