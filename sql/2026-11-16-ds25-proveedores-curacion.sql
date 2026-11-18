-- DS-25 (ronda DS, 16-nov-2026; issues #65/#78/#81/#86): curacion de proveedores. ADITIVA.
--  * indices: trigram sobre el nombre, RNC normalizado y las FK que faltaban (consultas de «con movimiento real»).
--  * vista sgc.v_proveedores_movimiento: cuantos documentos reales (OC, entradas, conduces, retiros, viajes, mantenimientos,
--    contratos) usan a cada proveedor (sin pruebas) -> marca «con movimiento real».
--  * RPC de duplicados por similitud (pg_trgm) o RNC igual, ratificacion en lote y lista de ids para los selectores
--    (<= 300 opciones: ratificados + con movimiento). La restriccion de selectores esta APAGADA por defecto
--    (parametro proveedores_selector_restringido) hasta que Compras ratifique; el origen de verdad es Odoo.

create extension if not exists pg_trgm;

create index if not exists ds25_proveedores_nombre_trgm_ix on sgc.proveedores using gin (lower(nombre) gin_trgm_ops);
create index if not exists ds25_proveedores_rnc_norm_ix on sgc.proveedores ((regexp_replace(coalesce(rnc, ''), '\D', '', 'g')))
  where rnc is not null;

do $$
declare r record;
begin
  for r in select * from (values
      ('sgc.ordenes_compra', 'proveedor_id'), ('sgc.entradas_inventario', 'proveedor_id'), ('sgc.contratos', 'proveedor_id'),
      ('sgc.retiros_material', 'transporta_proveedor_id'), ('sgc.retiros_material', 'proveedor_devolucion_id')) as v(tabla, col)
  loop
    if not exists (
      select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = r.tabla::regclass and a.attname = r.col) then
      execute format('create index %I on %s (%I)', 'ds25_' || split_part(r.tabla, '.', 2) || '_' || r.col || '_ix', r.tabla, r.col);
    end if;
  end loop;
end $$;

insert into sgc.parametros (clave, valor, descripcion) values
  ('proveedores_selector_restringido', 'false', 'DS-25: si es true, los selectores de proveedor muestran solo ratificados o con movimiento real (max. 300). Apagado hasta que Compras ratifique.'),
  ('proveedores_duplicados_umbral', '0.6', 'DS-25: similitud minima (pg_trgm, 0-1) para marcar dos proveedores como posibles duplicados.')
on conflict (clave) do nothing;

create or replace view sgc.v_proveedores_movimiento with (security_invoker = true) as
  select proveedor_id, count(*)::bigint as movimientos from (
    select proveedor_id from sgc.ordenes_compra where proveedor_id is not null and coalesce(es_prueba, false) = false
    union all select proveedor_id from sgc.entradas_inventario where proveedor_id is not null and coalesce(es_prueba, false) = false
    union all select transporta_proveedor_id from sgc.conduces_externos where transporta_proveedor_id is not null and coalesce(es_prueba, false) = false
    union all select transporta_proveedor_id from sgc.retiros_material where transporta_proveedor_id is not null and coalesce(es_prueba, false) = false
    union all select proveedor_devolucion_id from sgc.retiros_material where proveedor_devolucion_id is not null and coalesce(es_prueba, false) = false
    union all select proveedor_id from sgc.viajes_transporte where proveedor_id is not null and coalesce(es_prueba, false) = false
    union all select proveedor_id from sgc.mantenimientos where proveedor_id is not null and coalesce(es_prueba, false) = false
    union all select proveedor_id from sgc.contratos where proveedor_id is not null
  ) x group by proveedor_id;
grant select on sgc.v_proveedores_movimiento to authenticated, service_role;

-- Lista de curacion: cada proveedor con su movimiento real y ratificacion.
create or replace function sgc.proveedores_curacion_listar()
returns table (id uuid, nombre text, rnc text, activo boolean, movimientos bigint, ratificado_en timestamptz, vinculado_odoo boolean)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No tienes acceso a la curación de proveedores.' using errcode = '42501'; end if;
  return query
    select p.id, p.nombre::text, p.rnc::text, p.activo, coalesce(m.movimientos, 0), p.ratificado_en, p.odoo_id is not null
      from sgc.proveedores p left join sgc.v_proveedores_movimiento m on m.proveedor_id = p.id
     where coalesce(p.es_prueba, false) = false
     order by coalesce(m.movimientos, 0) desc, p.nombre;
end $fn$;

-- Posibles duplicados: nombre parecido (pg_trgm >= umbral) o mismo RNC (>= 9 digitos). Cada par una sola vez.
create or replace function sgc.proveedores_duplicados(p_umbral numeric default null)
returns table (a_id uuid, a_nombre text, a_mov bigint, a_ratificado boolean, b_id uuid, b_nombre text, b_mov bigint, b_ratificado boolean, similitud numeric, mismo_rnc boolean)
language plpgsql stable security definer set search_path = sgc, public, pg_temp as $fn$
declare v_u numeric;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No tienes acceso a la curación de proveedores.' using errcode = '42501'; end if;
  select coalesce(p_umbral, nullif((select valor from sgc.parametros where clave = 'proveedores_duplicados_umbral'), '')::numeric, 0.6) into v_u;
  perform set_config('pg_trgm.similarity_threshold', v_u::text, true);
  return query
    select a.id, a.nombre::text, coalesce(ma.movimientos, 0), a.ratificado_en is not null,
           b.id, b.nombre::text, coalesce(mb.movimientos, 0), b.ratificado_en is not null,
           round(similarity(lower(a.nombre), lower(b.nombre))::numeric, 2),
           (length(regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g')) >= 9
            and regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g') = regexp_replace(coalesce(b.rnc, ''), '\D', '', 'g'))
      from sgc.proveedores a
      join sgc.proveedores b on a.id < b.id
        and (lower(a.nombre) % lower(b.nombre)
             or (length(regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g')) >= 9
                 and regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g') = regexp_replace(coalesce(b.rnc, ''), '\D', '', 'g')))
      left join sgc.v_proveedores_movimiento ma on ma.proveedor_id = a.id
      left join sgc.v_proveedores_movimiento mb on mb.proveedor_id = b.id
     where a.activo and b.activo and coalesce(a.es_prueba, false) = false and coalesce(b.es_prueba, false) = false
     order by 9 desc
     limit 500;
end $fn$;

-- Ratificacion en lote (Compras/admin). No toca datos de Odoo: se silencia el outbox maestro solo alrededor del UPDATE.
create or replace function sgc.proveedores_ratificar_lote(p_ids uuid[])
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer; v_prev text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No autorizado para ratificar proveedores.' using errcode = '42501'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'No hay proveedores seleccionados.' using errcode = '22023'; end if;
  if cardinality(p_ids) > 500 then raise exception 'Máximo 500 proveedores por lote.' using errcode = '22023'; end if;
  v_prev := current_setting('sgc.odoo_importando', true);
  perform set_config('sgc.odoo_importando', 'true', true);
  update sgc.proveedores set ratificado_por = auth.uid(), ratificado_en = now() where id = any(p_ids) and ratificado_en is null and coalesce(es_prueba, false) = false;
  get diagnostics v_n = row_count;
  perform set_config('sgc.odoo_importando', coalesce(v_prev, 'false'), true);
  return v_n;
end $fn$;

-- Ids que muestran los selectores: ratificados primero, luego los de mayor movimiento, tope 300. Con la restriccion
-- apagada devuelve {restringido:false} y el cliente no filtra nada.
create or replace function sgc.proveedores_ids_selector()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_on boolean;
begin
  if auth.uid() is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  select coalesce(lower((select valor from sgc.parametros where clave = 'proveedores_selector_restringido')) = 'true', false) into v_on;
  if not v_on then return jsonb_build_object('restringido', false, 'ids', '[]'::jsonb); end if;
  return jsonb_build_object('restringido', true, 'ids', coalesce((
    select jsonb_agg(x.id) from (
      select p.id from sgc.proveedores p left join sgc.v_proveedores_movimiento m on m.proveedor_id = p.id
       where p.activo and coalesce(p.es_prueba, false) = false and (p.ratificado_en is not null or coalesce(m.movimientos, 0) > 0)
       order by (p.ratificado_en is not null) desc, coalesce(m.movimientos, 0) desc, p.nombre limit 300) x), '[]'::jsonb));
end $fn$;

revoke all on function sgc.proveedores_curacion_listar(), sgc.proveedores_duplicados(numeric), sgc.proveedores_ratificar_lote(uuid[]), sgc.proveedores_ids_selector() from public, anon;
grant execute on function sgc.proveedores_curacion_listar(), sgc.proveedores_duplicados(numeric), sgc.proveedores_ratificar_lote(uuid[]), sgc.proveedores_ids_selector() to authenticated; -- gatean adentro
