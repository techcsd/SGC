-- DS-46 (#71) lote 1: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: stock_por_bodega, bitacoras, notificaciones, usuario_preferencias, solicitudes_material, solicitud_material_items, solicitudes_compra, solicitud_compra_items, tareas, tarea_comentarios. Semantica identica; reversa en sql/_reversa/.

alter policy "bitacoras: insert" on sgc.bitacoras
  with check ((usuario_id = (select auth.uid())));

alter policy "bitacoras: select" on sgc.bitacoras
  using (((usuario_id = (select auth.uid())) OR sgc.puede_ver_bitacora_de(proyecto_id)));

alter policy "es_prueba: oculta a no-admin" on sgc.bitacoras
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.bitacoras
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "notif_del" on sgc.notificaciones
  using ((usuario_id = (select auth.uid())));

alter policy "notif_sel" on sgc.notificaciones
  using ((usuario_id = (select auth.uid())));

alter policy "notif_upd" on sgc.notificaciones
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));

alter policy "solicitud_compra_items: insert" on sgc.solicitud_compra_items
  with check ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_compra s
  WHERE ((s.id = solicitud_compra_items.solicitud_id) AND (s.solicitante_id = (select auth.uid()))))));

alter policy "solicitud_compra_items: select" on sgc.solicitud_compra_items
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_compra s
  WHERE ((s.id = solicitud_compra_items.solicitud_id) AND ((s.solicitante_id = (select auth.uid())) OR (s.aprobador_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text)))))));

alter policy "submod op-del: compras.solicitudes" on sgc.solicitud_compra_items
  using (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text));

alter policy "submod op-ins: compras.solicitudes" on sgc.solicitud_compra_items
  with check (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text));

alter policy "submod op-upd: compras.solicitudes" on sgc.solicitud_compra_items
  using (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text));

alter policy "submod ver: compras.solicitudes" on sgc.solicitud_compra_items
  using (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "solicitud_material_items: insert" on sgc.solicitud_material_items
  with check ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_material s
  WHERE ((s.id = solicitud_material_items.solicitud_id) AND (s.solicitante_id = (select auth.uid()))))));

alter policy "solicitud_material_items: select" on sgc.solicitud_material_items
  using ((EXISTS ( SELECT 1
   FROM sgc.solicitudes_material s
  WHERE ((s.id = solicitud_material_items.solicitud_id) AND ((s.solicitante_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)))))));

alter policy "solicitudes_compra: insert" on sgc.solicitudes_compra
  with check ((solicitante_id = (select auth.uid())));

alter policy "solicitudes_compra: select" on sgc.solicitudes_compra
  using (((solicitante_id = (select auth.uid())) OR (aprobador_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "solicitudes_compra: update" on sgc.solicitudes_compra
  using ((((select sgc.is_admin()) OR (select sgc.tiene_modulo('compras'::text))) AND (estado = 'pendiente'::text)))
  with check (((atendido_por = (select auth.uid())) AND (estado = ANY (ARRAY['rechazada'::text, 'convertida'::text])) AND ((select sgc.is_admin()) OR (solicitante_id <> (select auth.uid()))) AND ((orden_compra_id IS NULL) OR (EXISTS ( SELECT 1
   FROM sgc.ordenes_compra oc
  WHERE ((oc.id = solicitudes_compra.orden_compra_id) AND ((oc.proyecto_id IS NULL) OR (oc.proyecto_id = solicitudes_compra.proyecto_id))))))));

alter policy "submod op-del: compras.solicitudes" on sgc.solicitudes_compra
  using (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text));

alter policy "submod op-ins: compras.solicitudes" on sgc.solicitudes_compra
  with check (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text));

alter policy "submod op-upd: compras.solicitudes" on sgc.solicitudes_compra
  using (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = 'operar'::text));

alter policy "submod ver: compras.solicitudes" on sgc.solicitudes_compra
  using (((select sgc.submodulo_nivel_explicito('compras.solicitudes'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "req_demo_solo_demo" on sgc.solicitudes_material
  using (((NOT (select sgc.es_usuario_demo())) OR (EXISTS ( SELECT 1
   FROM sgc.proyectos p
  WHERE ((p.id = solicitudes_material.proyecto_id) AND COALESCE(p.es_prueba, false))))));

alter policy "solicitudes_material: insert" on sgc.solicitudes_material
  with check ((solicitante_id = (select auth.uid())));

alter policy "solicitudes_material: select" on sgc.solicitudes_material
  using (((solicitante_id = (select auth.uid())) OR (select sgc.puede_ver_todas_requisiciones())));

alter policy "solicitudes_material: update" on sgc.solicitudes_material
  using ((((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))) AND (estado = 'pendiente'::text)))
  with check (((atendido_por = (select auth.uid())) AND (estado = ANY (ARRAY['rechazada'::text, 'entregada'::text])) AND ((select sgc.is_admin()) OR (solicitante_id <> (select auth.uid()))) AND ((salida_id IS NULL) OR (EXISTS ( SELECT 1
   FROM sgc.salidas_inventario si
  WHERE ((si.id = solicitudes_material.salida_id) AND ((si.proyecto_id IS NULL) OR (si.proyecto_id = solicitudes_material.proyecto_id))))))));

alter policy "stock_por_bodega: delete" on sgc.stock_por_bodega
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "stock_por_bodega: insert" on sgc.stock_por_bodega
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "stock_por_bodega: referencia autenticados" on sgc.stock_por_bodega
  using (((select auth.uid()) IS NOT NULL));

alter policy "stock_por_bodega: select" on sgc.stock_por_bodega
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "stock_por_bodega: update" on sgc.stock_por_bodega
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "stock_select" on sgc.stock_por_bodega
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "tarea_comentarios: delete" on sgc.tarea_comentarios
  using (((select sgc.is_admin()) OR (usuario_id = (select auth.uid()))));

alter policy "tarea_comentarios: insert" on sgc.tarea_comentarios
  with check (((usuario_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM sgc.tareas t
  WHERE ((t.id = tarea_comentarios.tarea_id) AND ((select sgc.is_admin()) OR (select sgc.tiene_modulo('tareas'::text)) OR (t.asignado_a = (select auth.uid())) OR (t.asignado_por = (select auth.uid()))))))));

alter policy "tarea_comentarios: select" on sgc.tarea_comentarios
  using ((EXISTS ( SELECT 1
   FROM sgc.tareas t
  WHERE ((t.id = tarea_comentarios.tarea_id) AND ((select sgc.is_admin()) OR (select sgc.tiene_modulo('tareas'::text)) OR (t.asignado_a = (select auth.uid())) OR (t.asignado_por = (select auth.uid())))))));

alter policy "tareas: delete" on sgc.tareas
  using (((select sgc.is_admin()) OR ((select sgc.tiene_modulo('tareas'::text)) AND (asignado_por = (select auth.uid())))));

alter policy "tareas: insert" on sgc.tareas
  with check ((((select sgc.is_admin()) OR (select sgc.tiene_modulo('tareas'::text))) AND (asignado_por = (select auth.uid()))));

alter policy "tareas: select" on sgc.tareas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tareas'::text)) OR (asignado_a = (select auth.uid())) OR (asignado_por = (select auth.uid()))));

alter policy "tareas: update" on sgc.tareas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tareas'::text)) OR (asignado_a = (select auth.uid()))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tareas'::text)) OR (asignado_a = (select auth.uid()))));

alter policy "up_insert_own" on sgc.usuario_preferencias
  with check ((usuario_id = (select auth.uid())));

alter policy "up_select_own" on sgc.usuario_preferencias
  using ((usuario_id = (select auth.uid())));

alter policy "up_update_own" on sgc.usuario_preferencias
  using ((usuario_id = (select auth.uid())))
  with check ((usuario_id = (select auth.uid())));
