// Issues #55 y #58 (sub-pieza) -- smoke transaccional (ROLLBACK).
// dj6: avisos_flota_tipo_chk acepta 'vehiculo_sin_echada'.
// dj7: sgc.anular_conduce exige motivo >= 10 caracteres, resto de su
// comportamiento (reversion de stock, ruta, auditoria, aviso) sin cambios.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_vehiculo_id uuid;
  v_admin_id uuid;
  v_proveedor_id uuid;
  v_bodega_id uuid;
  v_articulo_id uuid;
  v_salida_id uuid;
begin
  select id into v_vehiculo_id from sgc.vehiculos limit 1;
  select ur.usuario_id into v_admin_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'admin'=any(r.modulos) limit 1;
  select id into v_proveedor_id from sgc.proveedores where activo limit 1;
  select id into v_bodega_id from sgc.bodegas limit 1;
  select id into v_articulo_id from sgc.articulos limit 1;
  if v_vehiculo_id is null or v_admin_id is null or v_bodega_id is null or v_articulo_id is null then
    raise exception 'FALLO_SETUP';
  end if;

  -- 1. dj6: el tipo 'vehiculo_sin_echada' ahora pasa el CHECK.
  insert into sgc.avisos_flota (tipo, vehiculo_id, mensaje, severidad, estado, es_prueba)
    values ('vehiculo_sin_echada', v_vehiculo_id, 'smoke dj6', 'media', 'pendiente', true);
  raise notice 'OK: avisos_flota_tipo_chk acepta vehiculo_sin_echada';

  -- 2. dj7: crear una salida/conduce de prueba y anularla.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  insert into sgc.salidas_inventario (fecha, bodega_id, motivo, estado, creado_por, es_prueba)
    values (current_date, v_bodega_id, 'smoke dj7', 'despachado', v_admin_id, true) returning id into v_salida_id;
  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad) values (v_salida_id, v_articulo_id, 1);

  -- 2a. Sin motivo -> rechaza.
  begin
    perform sgc.anular_conduce(v_salida_id, null);
    raise exception 'FALLO: anuló sin motivo';
  exception when others then
    if sqlerrm like '%al menos 10 caracteres%' then raise notice 'OK: anular sin motivo se rechaza'; else raise; end if;
  end;

  -- 2b. Motivo corto -> rechaza.
  begin
    perform sgc.anular_conduce(v_salida_id, 'corto');
    raise exception 'FALLO: anuló con motivo corto';
  exception when others then
    if sqlerrm like '%al menos 10 caracteres%' then raise notice 'OK: motivo corto se rechaza'; else raise; end if;
  end;

  -- 2c. Motivo válido -> se acepta, queda anulado con el motivo guardado.
  perform sgc.anular_conduce(v_salida_id, 'Pedido duplicado por error de digitación');
  if (select estado from sgc.salidas_inventario where id = v_salida_id) <> 'anulado' then
    raise exception 'FALLO: no quedó anulado con motivo válido';
  end if;
  if (select motivo_anulacion from sgc.salidas_inventario where id = v_salida_id) is null then
    raise exception 'FALLO: motivo_anulacion no se guardó';
  end if;
  raise notice 'OK: anular_conduce con motivo válido funciona y preserva el resto del comportamiento (AQ10)';

  reset role;
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ Issues #55/#58: avisos_flota_tipo_chk + anular_conduce motivo obligatorio (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ smoke-dj6-dj7 falló:', e.message.slice(0, 2000));
  process.exit(1);
}
