// CY6 resto -- smoke transaccional (ROLLBACK) del outbox de documentos con
// cabecera+renglones. Prueba lo que de verdad importa de este diseño: que un
// documento cuyos renglones se insertan con UN bulk INSERT (patrón de
// crear_retiro_material/aprobar_requisicion/crear_solicitud_compra_app) Y uno
// cuyos renglones se insertan en un LOOP de sentencias individuales (patrón
// de confirmar_entrada_chofer) terminan AMBOS en un solo evento completo, no
// fragmentado -- porque el trigger va en la cabecera y esta DEFERRED al
// commit, no en los renglones.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_instancia_id uuid;
  v_bodega_id uuid;
  v_proveedor_id uuid;
  v_usuario_id uuid;
  v_articulo1_id uuid;
  v_articulo2_id uuid;
  v_entrada_id uuid;
  v_retiro_id uuid;
  v_evento_entrada jsonb;
  v_evento_retiro jsonb;
  v_num_lineas integer;
begin
  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('CY6c smoke', 'https://smoke.test', 'smoke', 'dev', true) returning id into v_instancia_id;
  select id into v_bodega_id from sgc.bodegas limit 1;
  select id into v_proveedor_id from sgc.proveedores limit 1;
  select id into v_usuario_id from sgc.usuarios limit 1;
  select id into v_articulo1_id from sgc.articulos limit 1;
  select id into v_articulo2_id from sgc.articulos offset 1 limit 1;
  if v_bodega_id is null or v_proveedor_id is null or v_usuario_id is null or v_articulo1_id is null or v_articulo2_id is null then
    raise exception 'FALLO_SETUP: faltan datos de prueba (bodega/proveedor/usuario/2 articulos)';
  end if;

  -- ===== CASO 1: renglones insertados con UN loop de sentencias individuales
  -- (patron real de confirmar_entrada_chofer) =====
  insert into sgc.entradas_inventario (fecha, bodega_id, proveedor_id, referencia, creado_por)
    values (current_date, v_bodega_id, v_proveedor_id, 'CY6c smoke entrada', v_usuario_id) returning id into v_entrada_id;
  -- Dos INSERT separados (simula el loop de confirmar_entrada_chofer) DENTRO de la misma transaccion.
  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad) values (v_entrada_id, v_articulo1_id, 10);
  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad) values (v_entrada_id, v_articulo2_id, 20);
  -- Update de la cabecera (como hace confirmar_entrada_chofer al confirmar) -- dispara el trigger deferred de nuevo (revision 2).
  update sgc.entradas_inventario set observaciones = 'confirmada' where id = v_entrada_id;

  -- Antes del commit/set constraints, el trigger deferred TODAVIA no corrio.
  perform 1 from sgc.odoo_eventos where agregado_tipo = 'entrada_inventario' and agregado_id = v_entrada_id::text;
  if found then raise exception 'FALLO: el evento se creo ANTES de tiempo (deberia estar deferred al commit)'; end if;

  -- Forzar la ejecucion de los triggers deferred ahora (equivalente a hacer commit, sin perder la transaccion -- set constraints all immediate dispara los pendientes de inmediato).
  set constraints all immediate;

  select count(*) into v_num_lineas from sgc.odoo_eventos where agregado_tipo = 'entrada_inventario' and agregado_id = v_entrada_id::text;
  if v_num_lineas <> 2 then
    raise exception 'FALLO: esperaba 2 eventos (insert + update de cabecera), hay %', v_num_lineas;
  end if;
  select payload into v_evento_entrada from sgc.odoo_eventos where agregado_tipo='entrada_inventario' and agregado_id=v_entrada_id::text and revision=1;
  if jsonb_array_length(v_evento_entrada->'lineas') <> 2 then
    raise exception 'FALLO: el evento de la entrada (loop de inserts) no trae los 2 renglones -- trae %', jsonb_array_length(v_evento_entrada->'lineas');
  end if;
  raise notice 'OK: entrada con renglones insertados en LOOP -- 1 evento completo con 2 lineas (no fragmentado)';

  -- ===== CASO 2: renglones insertados con UN bulk INSERT...SELECT (patron real
  -- de crear_retiro_material) =====
  -- "set constraints all immediate" del caso 1 dejo el modo en INMEDIATO para
  -- el resto de la transaccion (no es un "flush de una vez", cambia el modo).
  -- Hay que devolverlo a DEFERRED para que el header de este segundo caso
  -- vuelva a esperar al "set constraints" de abajo -- en un uso real (una
  -- transaccion = un commit) esto nunca hace falta, es un artefacto de medir
  -- dos casos dentro de UNA sola transaccion de prueba.
  set constraints all deferred;
  insert into sgc.retiros_material (proyecto_id, solicitante_id, almacen_destino_id, motivo_dano, estado)
    select p.id, v_usuario_id, v_bodega_id, 'otro', 'pendiente' from sgc.proyectos p limit 1
    returning id into v_retiro_id;
  if v_retiro_id is null then raise exception 'FALLO_SETUP: no hay proyecto de prueba para retiros_material'; end if;
  insert into sgc.retiro_material_items (retiro_id, articulo_id, descripcion, cantidad)
    select v_retiro_id, a, 'CY6c smoke item', 5
    from unnest(array[v_articulo1_id, v_articulo2_id]) as a; -- UN solo INSERT, 2 filas (bulk real)

  set constraints all immediate;

  select payload into v_evento_retiro from sgc.odoo_eventos where agregado_tipo='retiro_material' and agregado_id=v_retiro_id::text and revision=1;
  if v_evento_retiro is null then raise exception 'FALLO: no se capturo evento del retiro'; end if;
  if jsonb_array_length(v_evento_retiro->'lineas') <> 2 then
    raise exception 'FALLO: el evento del retiro (bulk insert) no trae las 2 lineas -- trae %', jsonb_array_length(v_evento_retiro->'lineas');
  end if;
  raise notice 'OK: retiro con renglones en BULK INSERT -- 1 evento completo con 2 lineas';

  -- Guard anti-bucle tambien aplica a documentos.
  set constraints all deferred;
  perform set_config('sgc.odoo_importando', 'true', true);
  insert into sgc.retiros_material (proyecto_id, solicitante_id, almacen_destino_id, motivo_dano, estado)
    select p.id, v_usuario_id, v_bodega_id, 'otro', 'pendiente' from sgc.proyectos p limit 1;
  set constraints all immediate;
  perform set_config('sgc.odoo_importando', 'false', true);
  -- (no se verifica un id especifico aqui -- solo que no reviente; el guard ya se probo a fondo en CY6 maestros)

  raise notice 'TODO OK -- ROLLBACK';
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY6 resto (documentos): entrada con loop de inserts y retiro con bulk insert -- ambos capturan 1 evento completo con todos los renglones (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY6c smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
