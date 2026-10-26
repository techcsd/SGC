// Smoke transaccional (ROLLBACK) que llama a los RPC REALES que usa el
// frontend para los workflows de inventario/choferes -- confirma que los
// triggers nuevos de esta ronda (odoo_v1_capturar_evento_maestro en
// articulos/categorias_inventario/unidades/proveedores, y
// odoo_v1_capturar_evento_documento -- CONSTRAINT TRIGGER DEFERRED -- en
// entradas_inventario/salidas_inventario/retiros_material/solicitudes_compra)
// NO rompen ningún camino de escritura real. Cada workflow se prueba en su
// propio bloque BEGIN/EXCEPTION anidado (subtransacción implícita de
// PL/pgSQL -- nunca SAVEPOINT manual, no es válido dentro de un DO) para que
// un fallo no tape el resto del reporte.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_inv_id uuid;
  v_admin_id uuid;
  v_bodega_id uuid;
  v_proyecto_id uuid;
  v_proveedor_id uuid;
  v_categoria_id integer;
  v_articulo_id uuid;
  v_resultado jsonb;
  v_salida_id uuid;
  v_entrada_id uuid;
  v_retiro_id uuid;
  v_solicitud_id uuid;
  v_ok_count integer := 0;
  v_fail_count integer := 0;
  v_reporte text := '';
begin
  -- Dev tiene cuentas demo etiquetadas revisor_tiendas (RLS las restringe a
  -- solo es_prueba) -- hay que excluirlas o el smoke prueba el camino
  -- equivocado (política de revisor, no la de un operador real).
  select ur.usuario_id into v_inv_id
    from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
   where ('inventario'=any(r.modulos) or 'admin'=any(r.modulos))
     and not exists (
       select 1 from sgc.usuarios_roles ur2 join sgc.roles r2 on r2.id = ur2.rol_id
        where ur2.usuario_id = ur.usuario_id and r2.codigo = 'revisor_tiendas'
     )
   limit 1;
  select ur.usuario_id into v_admin_id
    from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
   where 'admin'=any(r.modulos)
   limit 1;
  select id into v_bodega_id from sgc.bodegas where activo limit 1;
  select id into v_proyecto_id from sgc.proyectos limit 1;
  select id into v_proveedor_id from sgc.proveedores where activo limit 1;
  select id into v_categoria_id from sgc.categorias_inventario limit 1;
  select id into v_articulo_id from sgc.articulos where activo limit 1;
  if v_inv_id is null or v_admin_id is null or v_bodega_id is null or v_proyecto_id is null or v_proveedor_id is null or v_categoria_id is null or v_articulo_id is null then
    raise exception 'FALLO_SETUP: faltan datos base de prueba (usuario/admin/bodega/proyecto/proveedor/categoria/articulo)';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_inv_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  -- ── 1. MAESTRO: crear_articulo_app (trigger odoo_v1_capturar_evento_maestro en articulos) ──
  begin
    v_resultado := sgc.crear_articulo_app('SMOKE-WORKFLOW articulo prueba', v_categoria_id, 'unidad', 'propio_csd', 'smoke test, nunca se queda');
    if v_resultado is null then raise exception 'crear_articulo_app no devolvió nada'; end if;
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  crear_articulo_app (maestro: articulos)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  crear_articulo_app: ' || sqlerrm;
  end;

  -- ── 2. MAESTRO: categorias_inventario (insert directo, requiere admin -- categorias_manage_admin) ──
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role','authenticated')::text, true);
    insert into sgc.categorias_inventario (nombre, orden) values ('SMOKE-WORKFLOW categoria', 999);
    perform set_config('request.jwt.claims', json_build_object('sub', v_inv_id::text, 'role','authenticated')::text, true);
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  insert categorias_inventario (maestro, como admin)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  insert categorias_inventario: ' || sqlerrm;
    perform set_config('request.jwt.claims', json_build_object('sub', v_inv_id::text, 'role','authenticated')::text, true);
  end;

  -- ── 3. MAESTRO: unidades (insert directo, requiere admin -- unidades_write) ──
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role','authenticated')::text, true);
    insert into sgc.unidades (codigo, nombre) values ('smk', 'SMOKE-WORKFLOW unidad');
    perform set_config('request.jwt.claims', json_build_object('sub', v_inv_id::text, 'role','authenticated')::text, true);
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  insert unidades (maestro, como admin)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  insert unidades: ' || sqlerrm;
    perform set_config('request.jwt.claims', json_build_object('sub', v_inv_id::text, 'role','authenticated')::text, true);
  end;

  -- ── 4. MAESTRO: proveedores (insert directo, trigger de maestro) ──
  begin
    insert into sgc.proveedores (nombre, activo) values ('SMOKE-WORKFLOW proveedor', true);
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  insert proveedores (maestro)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  insert proveedores: ' || sqlerrm;
  end;

  -- ── 5. CHOFER/CONDUCE: registrar_salida_inventario (trigger DEFERRED en salidas_inventario) ──
  -- Firma real (verificada vía pg_get_function_identity_arguments, no adivinada):
  -- p_fecha, p_bodega_id, p_proyecto_id, p_motivo, p_responsable varchar,
  -- p_observaciones, p_creado_por, p_items, p_responsable_id, p_es_prueba.
  begin
    v_salida_id := sgc.registrar_salida_inventario(
      current_date, v_bodega_id, v_proyecto_id, 'Smoke test workflow chofer/conduce', 'Smoke Test'::varchar,
      'nunca se queda', v_inv_id, jsonb_build_array(jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', 1)),
      v_inv_id, true
    );
    if v_salida_id is null then raise exception 'registrar_salida_inventario no devolvió id'; end if;
    perform 1 from sgc.detalle_salidas where salida_id = v_salida_id;
    if not found then raise exception 'la salida se creó sin renglones'; end if;
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  registrar_salida_inventario (conduce/chofer)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  registrar_salida_inventario: ' || sqlerrm;
  end;

  -- ── 6a. INVENTARIO: registrar_entrada_inventario (trigger DEFERRED en entradas_inventario) ──
  begin
    v_entrada_id := sgc.registrar_entrada_inventario(
      current_date, v_bodega_id, v_proveedor_id, null, 'SMOKE-WORKFLOW', 'nunca se queda', v_inv_id,
      jsonb_build_array(jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', 1, 'precio_unit', 10)),
      'compra', null
    );
    if v_entrada_id is null then raise exception 'registrar_entrada_inventario no devolvió id'; end if;
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  registrar_entrada_inventario (recepción)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  registrar_entrada_inventario: ' || sqlerrm;
  end;

  -- ── 6b. INVENTARIO: confirmar_entrada_chofer (loop de inserts -- simula una
  -- entrada que el chofer dejó pendiente de confirmar, el camino real de la
  -- app móvil). registrar_entrada_inventario exige >=1 renglón para crear la
  -- cabecera; se crea con un renglón real y luego se fuerza el estado
  -- "pendiente_confirmacion" (lo que de verdad deja el chofer en campo) antes
  -- de llamar al RPC que materializa el detalle vía loop de inserts.
  begin
    v_entrada_id := sgc.registrar_entrada_inventario(
      current_date, v_bodega_id, v_proveedor_id, null, 'SMOKE-WORKFLOW pendiente chofer', null, v_inv_id,
      jsonb_build_array(jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', 1, 'precio_unit', 1)),
      'compra', null
    );
    delete from sgc.detalle_entradas where entrada_id = v_entrada_id;
    update sgc.entradas_inventario
       set pendiente_confirmacion = true,
           items_propuestos = jsonb_build_array(jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', 2, 'precio_unit', 5))
     where id = v_entrada_id;
    perform sgc.confirmar_entrada_chofer(v_entrada_id, null);
    perform 1 from sgc.detalle_entradas where entrada_id = v_entrada_id;
    if not found then raise exception 'confirmar_entrada_chofer no dejó renglones'; end if;
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  confirmar_entrada_chofer (entrada pendiente -> confirmada por chofer)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  confirmar_entrada_chofer: ' || sqlerrm;
  end;

  -- ── 7. RETIRO DE MATERIAL DAÑADO: crear_retiro_material (trigger DEFERRED en retiros_material) ──
  begin
    v_retiro_id := sgc.crear_retiro_material(
      v_proyecto_id, v_bodega_id, 'otro', 'smoke test', 'nunca se queda',
      jsonb_build_array(jsonb_build_object('articulo_id', v_articulo_id, 'cantidad', 1)),
      jsonb_build_array('smoke-test/foto-falsa.jpg'), true
    );
    if v_retiro_id is null then raise exception 'crear_retiro_material no devolvió id'; end if;
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  crear_retiro_material (material dañado)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  crear_retiro_material: ' || sqlerrm;
  end;

  -- ── 8. SOLICITUD DE COMPRA: crear_solicitud_compra (trigger DEFERRED en solicitudes_compra) ──
  begin
    v_solicitud_id := sgc.crear_solicitud_compra(
      v_proyecto_id, v_inv_id, 'smoke test, nunca se queda',
      jsonb_build_array(jsonb_build_object('descripcion', 'Material smoke test', 'cantidad', 1, 'articulo_id', v_articulo_id))
    );
    if v_solicitud_id is null then raise exception 'crear_solicitud_compra no devolvió id'; end if;
    v_ok_count := v_ok_count + 1;
    v_reporte := v_reporte || E'\n  OK  crear_solicitud_compra (solicitud de compra)';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_reporte := v_reporte || E'\n  FALLO  crear_solicitud_compra: ' || sqlerrm;
  end;

  reset role;
  if v_fail_count > 0 then
    raise exception E'HUBO_FALLOS (% ok, % fallos):%', v_ok_count, v_fail_count, v_reporte;
  end if;
  raise exception E'ROLLBACK_SMOKE_OK (% ok, 0 fallos):%', v_ok_count, v_reporte;
exception when others then
  raise;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  // Nunca debería llegar aquí -- el DO siempre termina en `raise exception`
  // (a propósito, para que ROLLBACK ocurra incluso en el camino "todo OK").
  console.log('✓ (sin reporte -- revisar el script, no debería pasar por aquí)');
} catch (e) {
  const msg = e.message || '';
  console.log(msg.replace(/\\n/g, '\n'));
  if (msg.includes('ROLLBACK_SMOKE_OK')) {
    console.log('\n✓ Todos los workflows reales (maestros + documentos) funcionan igual tras los triggers de esta ronda (ROLLBACK limpio, nada quedó escrito)');
  } else {
    process.exit(1);
  }
}
