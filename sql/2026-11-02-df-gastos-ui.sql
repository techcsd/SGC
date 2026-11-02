-- DF-gastos — primera pantalla real para sgc.gastos_directos (AS14, ago-2026),
-- que tenía backend completo (RPC + tabla) pero nunca se conectó a ninguna
-- pantalla. Agrega columnas fiscales opcionales (para que lo que ya lee
-- leer-recibo contexto=factura_general se pueda GUARDAR, no solo prellenar
-- y descartar — regla AT11) y un bucket de storage para la foto de la factura.
set search_path = sgc, public;

-- ── Columnas fiscales opcionales (aditivo, nunca se tocó esto en AS14) ──
alter table sgc.gastos_directos
  add column if not exists proveedor      text,
  add column if not exists rnc            text,
  add column if not exists ncf            text,
  add column if not exists numero_recibo  text;

-- ── RPC v2: mismo contrato de registrar_gasto_directo + campos fiscales ──
-- Nombre distinto (no overload) a propósito: dos funciones con el mismo
-- nombre y distinto número de argumentos ya causó ambigüedad en rondas
-- pasadas (BK/BN) cuando una no se dropeó a tiempo.
create or replace function sgc.registrar_gasto_directo_v2(
  p_id            uuid,
  p_proyecto_id   uuid,
  p_categoria     text,
  p_concepto      text,
  p_monto         numeric,
  p_fecha         date default null,
  p_recibo_path   text default null,
  p_proveedor     text default null,
  p_rnc           text default null,
  p_ncf           text default null,
  p_numero_recibo text default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_registrar_gasto_directo(p_proyecto_id) then
    raise exception 'No autorizado para registrar gastos en este proyecto.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_concepto,'')),'') is null then
    raise exception 'El concepto del gasto es obligatorio.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del gasto debe ser mayor que cero.';
  end if;

  insert into sgc.gastos_directos
    (id, proyecto_id, categoria_clave, concepto, monto, fecha, recibo_path,
     registrado_por, proveedor, rnc, ncf, numero_recibo)
  values
    (coalesce(p_id, gen_random_uuid()), p_proyecto_id,
     coalesce(nullif(p_categoria,''),'misc'), trim(p_concepto), p_monto,
     coalesce(p_fecha, current_date), nullif(p_recibo_path,''), auth.uid(),
     nullif(p_proveedor,''), nullif(p_rnc,''), nullif(p_ncf,''), nullif(p_numero_recibo,''))
  on conflict (id) do nothing
  returning id into v_id;

  return coalesce(v_id, p_id);
end;
$$;
grant execute on function sgc.registrar_gasto_directo_v2(
  uuid, uuid, text, text, numeric, date, text, text, text, text, text
) to authenticated, service_role;

-- ── Extiende el listado para exponer los campos fiscales (AT11: lo que se
--    lee se puede ver). Nadie más llama esta función todavía -- drop seguro.
drop function if exists sgc.gastos_directos_de_proyecto(uuid, date, date);
create function sgc.gastos_directos_de_proyecto(
  p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns table (
  id uuid, fecha date, categoria_clave text, categoria text,
  concepto text, monto numeric, recibo_path text,
  registrado_por uuid, registrado_por_nombre text, created_at timestamptz,
  proveedor text, rnc text, ncf text, numero_recibo text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select g.id, g.fecha, g.categoria_clave, coalesce(c.label, g.categoria_clave) as categoria,
         g.concepto, g.monto, g.recibo_path,
         g.registrado_por, sgc.nombre_usuario(g.registrado_por), g.created_at,
         g.proveedor, g.rnc, g.ncf, g.numero_recibo
  from sgc.gastos_directos g
  left join sgc.gasto_categorias c on c.clave = g.categoria_clave
  where g.proyecto_id = p_proyecto_id
    and sgc.puede_registrar_gasto_directo(p_proyecto_id)
    and (sgc.is_admin() or not coalesce(g.es_prueba, false))
    and (p_desde is null or g.fecha >= p_desde)
    and (p_hasta is null or g.fecha <= p_hasta)
  order by g.fecha desc, g.created_at desc;
$$;
grant execute on function sgc.gastos_directos_de_proyecto(uuid, date, date) to authenticated, service_role;

-- ── Bucket de storage para la foto de la factura (mismo patrón que sgc-retiro:
--    cualquier autenticado puede subir/leer/actualizar, la autorización real
--    vive en el RPC SECURITY DEFINER de arriba, no en el bucket). ──
insert into storage.buckets (id, name, public)
values ('sgc-gastos', 'sgc-gastos', false)
on conflict (id) do nothing;

drop policy if exists "sgc-gastos: authenticated read" on storage.objects;
create policy "sgc-gastos: authenticated read" on storage.objects
  for select to authenticated using (bucket_id = 'sgc-gastos');

drop policy if exists "sgc-gastos: authenticated upload" on storage.objects;
create policy "sgc-gastos: authenticated upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'sgc-gastos');

drop policy if exists "sgc-gastos: authenticated update" on storage.objects;
create policy "sgc-gastos: authenticated update" on storage.objects
  for update to authenticated using (bucket_id = 'sgc-gastos') with check (bucket_id = 'sgc-gastos');
