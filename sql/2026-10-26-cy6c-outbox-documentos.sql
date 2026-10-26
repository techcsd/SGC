-- CY6 resto -- outbox para los 4 documentos con cabecera+renglones que
-- faltaban (entradas, salidas, retiros, solicitudes de compra -- ver
-- inventario de las 9 RPC en docs/ODOO-DIAGNOSTICO-CONTRATO.md).
--
-- DECISION DE DISEÑO (pedida explícitamente por Xaviel): un evento de outbox
-- útil necesita la cabecera Y TODOS sus renglones juntos, no una fila a la
-- vez. Verificado contra las RPC reales: 3 de las 4 (`crear_retiro_material`,
-- `aprobar_requisicion`, `crear_solicitud_compra_app`) insertan renglones con
-- UN solo `INSERT ... SELECT ... FROM jsonb_array_elements(...)` (bulk), pero
-- `confirmar_entrada_chofer` los inserta en un LOOP (una sentencia INSERT por
-- renglón) -- un trigger de renglón fallaría para esa (dispararía una vez por
-- renglón, fragmentando el documento). Para que el mismo diseño sirva para
-- los dos casos sin depender de cómo esté escrita cada RPC (hoy o en el
-- futuro), el trigger va en la CABECERA, no en los renglones, y se declara
-- `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`: Postgres lo
-- encola y lo ejecuta justo antes del COMMIT de la transacción, momento en el
-- que TODOS los renglones (sin importar en cuántas sentencias se insertaron)
-- ya existen y son visibles. El trigger simplemente relee la cabecera + sus
-- renglones actuales en ese instante y arma UN snapshot completo.
--
-- Esto sigue siendo "en la misma transacción" (criterio 1 de CY6): si la
-- transacción revierte, el trigger deferred nunca llega a ejecutarse (nunca
-- hay COMMIT), así que tampoco hay evento.
--
-- 4 agregado_tipo nuevos: entrada_inventario, salida_inventario,
-- retiro_material, solicitud_compra. `ordenes_compra` (actualizada dentro de
-- confirmar_entrada_chofer) y `solicitudes_material`/`solicitud_material_items`
-- (actualizadas dentro de aprobar_requisicion) quedan FUERA a propósito: son
-- el lado "entrada" de otro documento (la OC ya es terreno de F10/CY24,
-- explícitamente gateado por D-08; la requisición es el documento de origen,
-- no el movimiento de stock que resulta -- ese ya lo captura salida_inventario).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('sgc.odoo_eventos') is null then
    raise exception 'Falta sgc.odoo_eventos -- aplica primero sql/2026-10-26-cy6-outbox-odoo.sql';
  end if;
end;
$preflight$;

alter table sgc.odoo_eventos drop constraint odoo_eventos_agregado_tipo_check;
alter table sgc.odoo_eventos add constraint odoo_eventos_agregado_tipo_check
  check (agregado_tipo in (
    'articulo', 'categoria_inventario', 'unidad', 'proveedor',
    'entrada_inventario', 'salida_inventario', 'retiro_material', 'solicitud_compra'
  ));

create or replace function sgc.odoo_v1_capturar_evento_documento()
returns trigger
language plpgsql
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_tipo text;
  v_id text := new.id::text;
  v_accion text := case tg_op when 'INSERT' then 'crear' else 'actualizar' end;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_revision integer;
  v_es_prueba boolean;
  v_payload jsonb;
begin
  if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then
    return new;
  end if;

  v_tipo := case tg_table_name
    when 'entradas_inventario' then 'entrada_inventario'
    when 'salidas_inventario' then 'salida_inventario'
    when 'retiros_material' then 'retiro_material'
    when 'solicitudes_compra' then 'solicitud_compra'
  end;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then return new; end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  -- Releer cabecera + renglones AHORA (deferred: estamos a punto de hacer
  -- commit, todos los renglones de esta transaccion ya existen sin importar
  -- en cuantas sentencias se insertaron).
  if v_tipo = 'entrada_inventario' then
    select to_jsonb(e) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb))
      into v_payload
      from sgc.entradas_inventario e left join sgc.detalle_entradas d on d.entrada_id = e.id
      where e.id = new.id group by e.id;
    v_es_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  elsif v_tipo = 'salida_inventario' then
    select to_jsonb(s) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb))
      into v_payload
      from sgc.salidas_inventario s left join sgc.detalle_salidas d on d.salida_id = s.id
      where s.id = new.id group by s.id;
    v_es_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  elsif v_tipo = 'retiro_material' then
    select to_jsonb(r) || jsonb_build_object(
        'lineas', coalesce((select jsonb_agg(to_jsonb(i)) from sgc.retiro_material_items i where i.retiro_id = r.id), '[]'::jsonb),
        'fotos', coalesce((select jsonb_agg(to_jsonb(f)) from sgc.retiro_material_fotos f where f.retiro_id = r.id), '[]'::jsonb)
      )
      into v_payload
      from sgc.retiros_material r where r.id = new.id;
    v_es_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  elsif v_tipo = 'solicitud_compra' then
    select to_jsonb(sc) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(i)) filter (where i.id is not null), '[]'::jsonb))
      into v_payload
      from sgc.solicitudes_compra sc left join sgc.solicitud_compra_items i on i.solicitud_id = sc.id
      where sc.id = new.id group by sc.id;
    v_es_prueba := false; -- solicitudes_compra no tiene columna es_prueba en este esquema
  end if;

  if v_payload is null then return new; end if; -- la cabecera no estaba (no deberia pasar, pero no se inventa un evento vacio)

  select coalesce(max(revision), 0) + 1 into v_revision
    from sgc.odoo_eventos where agregado_tipo = v_tipo and agregado_id = v_id;

  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_instancia_id, v_tipo, v_id, v_accion, v_revision, v_payload, v_es_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing;

  return new;
end;
$fn$;
comment on function sgc.odoo_v1_capturar_evento_documento is 'SGC Odoo foundation v1 (CY6 resto)';

create constraint trigger odoo_v1_capturar_evento_documento
  after insert or update on sgc.entradas_inventario
  deferrable initially deferred
  for each row execute function sgc.odoo_v1_capturar_evento_documento();
create constraint trigger odoo_v1_capturar_evento_documento
  after insert or update on sgc.salidas_inventario
  deferrable initially deferred
  for each row execute function sgc.odoo_v1_capturar_evento_documento();
create constraint trigger odoo_v1_capturar_evento_documento
  after insert or update on sgc.retiros_material
  deferrable initially deferred
  for each row execute function sgc.odoo_v1_capturar_evento_documento();
create constraint trigger odoo_v1_capturar_evento_documento
  after insert or update on sgc.solicitudes_compra
  deferrable initially deferred
  for each row execute function sgc.odoo_v1_capturar_evento_documento();

commit;
