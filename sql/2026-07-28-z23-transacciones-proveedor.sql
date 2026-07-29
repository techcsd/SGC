-- ============================================================================
-- Z23 — Conciliación de combustible: transacciones del proveedor (dedupe)
-- PROMPT-6 · FASE 7 · aditivo
-- ============================================================================
-- Guarda cada transacción del reporte (Total Energies) con Transacción_num único
-- para deduplicar entre importaciones. Se vincula a la factura y, cuando matchea,
-- al vehículo interno. Kilometraje del reporte = referencia (nunca pisa odómetro).
-- ============================================================================
create table if not exists sgc.combustible_transacciones_proveedor (
  id             uuid primary key default gen_random_uuid(),
  transaccion_num text not null unique,           -- clave de dedupe
  numero_factura text,
  fecha_factura  date,
  fecha_vencimiento date,
  total_factura  numeric,
  fecha          date,
  hora           text,
  numero_tarjeta text,
  numero_registro text,                           -- placa a veces
  titular        text,                            -- vehículo O persona
  titular_es_persona boolean not null default false,
  kilometraje    numeric,
  estacion_codigo text,
  estacion_ubicacion text,
  producto       text,
  galones        numeric,
  precio_unitario numeric,
  importe        numeric,
  ncf            text,
  trans_status   text,
  vehiculo_id    uuid references sgc.vehiculos(id) on delete set null,
  registro_id    uuid references sgc.registros_combustible(id) on delete set null,
  conciliacion_id uuid references sgc.conciliaciones_combustible(id) on delete set null,
  es_prueba      boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists idx_comb_trans_fecha on sgc.combustible_transacciones_proveedor (fecha desc);
create index if not exists idx_comb_trans_factura on sgc.combustible_transacciones_proveedor (numero_factura);

alter table sgc.combustible_transacciones_proveedor enable row level security;
drop policy if exists "comb_trans: flota" on sgc.combustible_transacciones_proveedor;
create policy "comb_trans: flota" on sgc.combustible_transacciones_proveedor
  for all to authenticated
  using (sgc.is_admin() or sgc.es_flota_elevado())
  with check (sgc.is_admin() or sgc.es_flota_elevado());
grant select, insert, update, delete on sgc.combustible_transacciones_proveedor to authenticated;
grant all on sgc.combustible_transacciones_proveedor to service_role;

-- RPC: inserta transacciones dedupeando por transaccion_num; devuelve cuántas nuevas.
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
      precio_unitario, importe, ncf, trans_status, vehiculo_id)
    select
      t->>'transaccion_num', t->>'numero_factura', nullif(t->>'fecha_factura','')::date,
      nullif(t->>'fecha_vencimiento','')::date, nullif(t->>'total_factura','')::numeric,
      nullif(t->>'fecha','')::date, t->>'hora', t->>'numero_tarjeta', t->>'numero_registro',
      t->>'titular', coalesce((t->>'titular_es_persona')::boolean,false),
      nullif(t->>'kilometraje','')::numeric, t->>'estacion_codigo', t->>'estacion_ubicacion',
      t->>'producto', nullif(t->>'galones','')::numeric, nullif(t->>'precio_unitario','')::numeric,
      nullif(t->>'importe','')::numeric, t->>'ncf', t->>'trans_status',
      nullif(t->>'vehiculo_id','')::uuid
    from jsonb_array_elements(coalesce(p_transacciones,'[]'::jsonb)) as t
    where t->>'transaccion_num' is not null
    on conflict (transaccion_num) do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end;
$function$;
grant execute on function sgc.importar_transacciones_combustible(jsonb) to authenticated, service_role;

-- Devuelve los transaccion_num ya existentes de una lista (para marcar duplicados en el preview).
create or replace function sgc.transacciones_existentes(p_nums text[])
returns text[]
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(array_agg(transaccion_num), '{}')
  from sgc.combustible_transacciones_proveedor
  where transaccion_num = any(p_nums);
$function$;
grant execute on function sgc.transacciones_existentes(text[]) to authenticated, service_role;
