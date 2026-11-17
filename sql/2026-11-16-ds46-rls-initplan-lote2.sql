-- DS-46 (#71) lote 2: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: notificaciones, stock_por_bodega, stock_apertura, assistant_mensajes, assistant_acciones, assistant_conversaciones, checklist_vehiculo_respuestas, checklist_vehiculo_fotos, bitacoras, rutas, usuarios_roles, usuarios, vehiculo_entrega_fotos, usuario_preferencias, solicitudes_material, recepcion_confirmaciones, vehiculo_usos, incentivo_dia, checklists_vehiculo, bodegas, salidas_inventario, tareas, notas, usuario_dispositivos, incentivo_participante. Semantica identica; reversa en sql/_reversa/.

alter policy "assistant_acc_rw" on sgc.assistant_acciones
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())))
  with check (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())));

alter policy "assistant_conv_rw" on sgc.assistant_conversaciones
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())))
  with check (((usuario_id = (select auth.uid())) OR (select sgc.is_admin())));

alter policy "revisor_solo_demo" on sgc.assistant_conversaciones
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "assistant_msg_rw" on sgc.assistant_mensajes
  using ((EXISTS ( SELECT 1
   FROM sgc.assistant_conversaciones c
  WHERE ((c.id = assistant_mensajes.conversacion_id) AND ((c.usuario_id = (select auth.uid())) OR (select sgc.is_admin()))))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.assistant_conversaciones c
  WHERE ((c.id = assistant_mensajes.conversacion_id) AND ((c.usuario_id = (select auth.uid())) OR (select sgc.is_admin()))))));

alter policy "bodegas: delete" on sgc.bodegas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "bodegas: insert" on sgc.bodegas
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "bodegas: referencia autenticados" on sgc.bodegas
  using (((select auth.uid()) IS NOT NULL));

alter policy "bodegas: select" on sgc.bodegas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (select sgc.tiene_modulo('compras'::text))));

alter policy "bodegas: update" on sgc.bodegas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "bodegas_manage" on sgc.bodegas
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "es_prueba: oculta a no-admin" on sgc.bodegas
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.bodegas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "chk_fotos_sel" on sgc.checklist_vehiculo_fotos
  using ((EXISTS ( SELECT 1
   FROM sgc.checklists_vehiculo h
  WHERE ((h.id = checklist_vehiculo_fotos.checklist_id) AND ((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text)) OR (h.creado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM sgc.conductores c
          WHERE ((c.id = h.conductor_id) AND (c.usuario_id = (select auth.uid()))))))))));

alter policy "chk_resp_sel" on sgc.checklist_vehiculo_respuestas
  using ((EXISTS ( SELECT 1
   FROM sgc.checklists_vehiculo h
  WHERE ((h.id = checklist_vehiculo_respuestas.checklist_id) AND ((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text)) OR (h.creado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM sgc.conductores c
          WHERE ((c.id = h.conductor_id) AND (c.usuario_id = (select auth.uid()))))))))));

alter policy "chk_veh_sel" on sgc.checklists_vehiculo
  using (((select sgc.es_flota_elevado()) OR (creado_por = (select auth.uid())) OR (conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "chk_veh_upd" on sgc.checklists_vehiculo
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "es_prueba: oculta a no-admin" on sgc.checklists_vehiculo
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.checklists_vehiculo
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "incentivo_dia: lectura" on sgc.incentivo_dia
  using (((select sgc.is_admin()) OR (select sgc.puede_gestionar_incentivos()) OR (usuario_id = (select auth.uid()))));

alter policy "incentivo_participante: gestion" on sgc.incentivo_participante
  using (((select sgc.is_admin()) OR (select sgc.puede_gestionar_incentivos()) OR (usuario_id = (select auth.uid()))));

alter policy "notas_del" on sgc.notas
  using ((owner_id = (select auth.uid())));

alter policy "notas_ins" on sgc.notas
  with check ((owner_id = (select auth.uid())));

alter policy "notas_sel" on sgc.notas
  using ((sgc.puede_ver_nota(id, (select auth.uid())) AND ((ambito <> 'dev'::text) OR (select sgc.es_desarrollador()))));

alter policy "notas_upd" on sgc.notas
  using (sgc.puede_editar_nota(id, (select auth.uid())))
  with check (sgc.puede_editar_nota(id, (select auth.uid())));

alter policy "es_prueba: oculta a no-admin" on sgc.recepcion_confirmaciones
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "recepcion_conf: select" on sgc.recepcion_confirmaciones
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR (select sgc.tiene_modulo('flota'::text)) OR (confirmado_por = (select auth.uid())) OR (aportado_por = (select auth.uid()))));

alter policy "revisor_solo_demo" on sgc.recepcion_confirmaciones
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "es_prueba: oculta a no-admin" on sgc.rutas
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.rutas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "rutas: delete" on sgc.rutas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "rutas: insert" on sgc.rutas
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "rutas: select" on sgc.rutas
  using (((select sgc.es_flota_elevado()) OR (creado_por = (select auth.uid())) OR (conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "rutas: update" on sgc.rutas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "submod op-del: flota.rutas" on sgc.rutas
  using (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text));

alter policy "submod op-ins: flota.rutas" on sgc.rutas
  with check (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text));

alter policy "submod op-upd: flota.rutas" on sgc.rutas
  using (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = 'operar'::text));

alter policy "submod ver: flota.rutas" on sgc.rutas
  using (((select sgc.submodulo_nivel_explicito('flota.rutas'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "es_prueba: oculta a no-admin" on sgc.salidas_inventario
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.salidas_inventario
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "salidas_insert" on sgc.salidas_inventario
  with check ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "salidas_inventario: delete" on sgc.salidas_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "salidas_inventario: insert" on sgc.salidas_inventario
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "salidas_inventario: select" on sgc.salidas_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text)) OR ((proyecto_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (sgc.proyecto_empleados pe
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((pe.proyecto_id = salidas_inventario.proyecto_id) AND (e.usuario_id = (select auth.uid()))))))));

alter policy "salidas_inventario: select conductor" on sgc.salidas_inventario
  using (((creado_por = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM sgc.conductores c
  WHERE ((c.id = salidas_inventario.conductor_id) AND (c.usuario_id = (select auth.uid())))))));

alter policy "salidas_inventario: update" on sgc.salidas_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "salidas_select" on sgc.salidas_inventario
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "submod op-del: inventario.salidas" on sgc.salidas_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.salidas" on sgc.salidas_inventario
  with check (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.salidas" on sgc.salidas_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = 'operar'::text));

alter policy "submod ver: inventario.salidas" on sgc.salidas_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.salidas'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "stock_apertura: referencia autenticados" on sgc.stock_apertura
  using (((select auth.uid()) IS NOT NULL));

alter policy "usuario_dispositivos: lectura tec/propio" on sgc.usuario_dispositivos
  using (((select sgc.es_tecnologia()) OR (usuario_id = (select auth.uid()))));

alter policy "revisor_solo_demo" on sgc.usuarios
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "usuarios: admin read all" on sgc.usuarios
  using (((select sgc.is_admin()) OR (id = (select auth.uid()))));

alter policy "usuarios: admin update" on sgc.usuarios
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "usuarios: read own" on sgc.usuarios
  using ((id = (select auth.uid())));

alter policy "usuarios_insert_admin" on sgc.usuarios
  with check (('admin'::text = ANY ((select sgc.get_user_roles())::text[])));

alter policy "usuarios_select_admin" on sgc.usuarios
  using (('admin'::text = ANY ((select sgc.get_user_roles())::text[])));

alter policy "usuarios_select_admin_dev" on sgc.usuarios
  using ((select sgc.es_desarrollador()));

alter policy "usuarios_select_own" on sgc.usuarios
  using ((id = (select auth.uid())));

alter policy "usuarios_update_admin" on sgc.usuarios
  using (('admin'::text = ANY ((select sgc.get_user_roles())::text[])));

alter policy "usuarios_roles: admin manage" on sgc.usuarios_roles
  using (((select sgc.is_admin()) OR (usuario_id = (select auth.uid()))))
  with check ((select sgc.is_admin()));

alter policy "usuarios_roles: read own" on sgc.usuarios_roles
  using ((usuario_id = (select auth.uid())));

alter policy "usuarios_roles_manage_admin" on sgc.usuarios_roles
  using (('admin'::text = ANY ((select sgc.get_user_roles())::text[])));

alter policy "usuarios_roles_select" on sgc.usuarios_roles
  using (((usuario_id = (select auth.uid())) OR ('admin'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "vef_select" on sgc.vehiculo_entrega_fotos
  using ((EXISTS ( SELECT 1
   FROM sgc.vehiculo_entregas e
  WHERE ((e.id = vehiculo_entrega_fotos.entrega_id) AND ((e.conductor_usuario_id = (select auth.uid())) OR (select sgc.tiene_modulo('flota'::text)))))));

alter policy "revisor_solo_demo" on sgc.vehiculo_usos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "vehiculo_usos_read" on sgc.vehiculo_usos
  using (((usuario_id = (select auth.uid())) OR (select sgc.es_flota_elevado()) OR (select sgc.es_tecnologia())));
