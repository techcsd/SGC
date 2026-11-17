-- Reversa de DS-46 lote 2: restaura las expresiones originales de las politicas.

alter policy "assistant_acc_rw" on sgc.assistant_acciones
  using (((usuario_id = auth.uid()) OR sgc.is_admin()))
  with check (((usuario_id = auth.uid()) OR sgc.is_admin()));

alter policy "assistant_conv_rw" on sgc.assistant_conversaciones
  using (((usuario_id = auth.uid()) OR sgc.is_admin()))
  with check (((usuario_id = auth.uid()) OR sgc.is_admin()));

alter policy "revisor_solo_demo" on sgc.assistant_conversaciones
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "assistant_msg_rw" on sgc.assistant_mensajes
  using ((EXISTS ( SELECT 1
   FROM sgc.assistant_conversaciones c
  WHERE ((c.id = assistant_mensajes.conversacion_id) AND ((c.usuario_id = auth.uid()) OR sgc.is_admin())))))
  with check ((EXISTS ( SELECT 1
   FROM sgc.assistant_conversaciones c
  WHERE ((c.id = assistant_mensajes.conversacion_id) AND ((c.usuario_id = auth.uid()) OR sgc.is_admin())))));

alter policy "bodegas: delete" on sgc.bodegas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "bodegas: insert" on sgc.bodegas
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "bodegas: referencia autenticados" on sgc.bodegas
  using ((auth.uid() IS NOT NULL));

alter policy "bodegas: select" on sgc.bodegas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR sgc.tiene_modulo('compras'::text)));

alter policy "bodegas: update" on sgc.bodegas
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "bodegas_manage" on sgc.bodegas
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles()))));

alter policy "es_prueba: oculta a no-admin" on sgc.bodegas
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.bodegas
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "chk_fotos_sel" on sgc.checklist_vehiculo_fotos
  using ((EXISTS ( SELECT 1
   FROM sgc.checklists_vehiculo h
  WHERE ((h.id = checklist_vehiculo_fotos.checklist_id) AND (sgc.is_admin() OR sgc.tiene_modulo('flota'::text) OR (h.creado_por = auth.uid()) OR (EXISTS ( SELECT 1
           FROM sgc.conductores c
          WHERE ((c.id = h.conductor_id) AND (c.usuario_id = auth.uid())))))))));

alter policy "chk_resp_sel" on sgc.checklist_vehiculo_respuestas
  using ((EXISTS ( SELECT 1
   FROM sgc.checklists_vehiculo h
  WHERE ((h.id = checklist_vehiculo_respuestas.checklist_id) AND (sgc.is_admin() OR sgc.tiene_modulo('flota'::text) OR (h.creado_por = auth.uid()) OR (EXISTS ( SELECT 1
           FROM sgc.conductores c
          WHERE ((c.id = h.conductor_id) AND (c.usuario_id = auth.uid())))))))));

alter policy "chk_veh_sel" on sgc.checklists_vehiculo
  using ((sgc.es_flota_elevado() OR (creado_por = auth.uid()) OR (conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "chk_veh_upd" on sgc.checklists_vehiculo
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "es_prueba: oculta a no-admin" on sgc.checklists_vehiculo
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.checklists_vehiculo
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "incentivo_dia: lectura" on sgc.incentivo_dia
  using ((sgc.is_admin() OR sgc.puede_gestionar_incentivos() OR (usuario_id = auth.uid())));

alter policy "incentivo_participante: gestion" on sgc.incentivo_participante
  using ((sgc.is_admin() OR sgc.puede_gestionar_incentivos() OR (usuario_id = auth.uid())));

alter policy "notas_del" on sgc.notas
  using ((owner_id = auth.uid()));

alter policy "notas_ins" on sgc.notas
  with check ((owner_id = auth.uid()));

alter policy "notas_sel" on sgc.notas
  using ((sgc.puede_ver_nota(id, auth.uid()) AND ((ambito <> 'dev'::text) OR sgc.es_desarrollador())));

alter policy "notas_upd" on sgc.notas
  using (sgc.puede_editar_nota(id, auth.uid()))
  with check (sgc.puede_editar_nota(id, auth.uid()));

alter policy "es_prueba: oculta a no-admin" on sgc.recepcion_confirmaciones
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "recepcion_conf: select" on sgc.recepcion_confirmaciones
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR sgc.tiene_modulo('flota'::text) OR (confirmado_por = auth.uid()) OR (aportado_por = auth.uid())));

alter policy "revisor_solo_demo" on sgc.recepcion_confirmaciones
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "es_prueba: oculta a no-admin" on sgc.rutas
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.rutas
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "rutas: delete" on sgc.rutas
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "rutas: insert" on sgc.rutas
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "rutas: select" on sgc.rutas
  using ((sgc.es_flota_elevado() OR (creado_por = auth.uid()) OR (conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "rutas: update" on sgc.rutas
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "submod op-del: flota.rutas" on sgc.rutas
  using ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text));

alter policy "submod op-ins: flota.rutas" on sgc.rutas
  with check ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text));

alter policy "submod op-upd: flota.rutas" on sgc.rutas
  using ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = 'operar'::text));

alter policy "submod ver: flota.rutas" on sgc.rutas
  using ((sgc.submodulo_nivel_explicito('flota.rutas'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "es_prueba: oculta a no-admin" on sgc.salidas_inventario
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.salidas_inventario
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "salidas_insert" on sgc.salidas_inventario
  with check ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles()))));

alter policy "salidas_inventario: delete" on sgc.salidas_inventario
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "salidas_inventario: insert" on sgc.salidas_inventario
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "salidas_inventario: select" on sgc.salidas_inventario
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR ((proyecto_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (sgc.proyecto_empleados pe
     JOIN sgc.empleados e ON ((e.id = pe.empleado_id)))
  WHERE ((pe.proyecto_id = salidas_inventario.proyecto_id) AND (e.usuario_id = auth.uid())))))));

alter policy "salidas_inventario: select conductor" on sgc.salidas_inventario
  using (((creado_por = auth.uid()) OR (EXISTS ( SELECT 1
   FROM sgc.conductores c
  WHERE ((c.id = salidas_inventario.conductor_id) AND (c.usuario_id = auth.uid()))))));

alter policy "salidas_inventario: update" on sgc.salidas_inventario
  using ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)))
  with check ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)));

alter policy "salidas_select" on sgc.salidas_inventario
  using ((('admin'::text = ANY (sgc.get_user_roles())) OR ('logistica'::text = ANY (sgc.get_user_roles())) OR ('gerencia'::text = ANY (sgc.get_user_roles()))));

alter policy "submod op-del: inventario.salidas" on sgc.salidas_inventario
  using ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text));

alter policy "submod op-ins: inventario.salidas" on sgc.salidas_inventario
  with check ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text));

alter policy "submod op-upd: inventario.salidas" on sgc.salidas_inventario
  using ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text))
  with check ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = 'operar'::text));

alter policy "submod ver: inventario.salidas" on sgc.salidas_inventario
  using ((sgc.submodulo_nivel_explicito('inventario.salidas'::text) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "stock_apertura: referencia autenticados" on sgc.stock_apertura
  using ((auth.uid() IS NOT NULL));

alter policy "usuario_dispositivos: lectura tec/propio" on sgc.usuario_dispositivos
  using ((sgc.es_tecnologia() OR (usuario_id = auth.uid())));

alter policy "revisor_solo_demo" on sgc.usuarios
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "usuarios: admin read all" on sgc.usuarios
  using ((sgc.is_admin() OR (id = auth.uid())));

alter policy "usuarios: admin update" on sgc.usuarios
  using (sgc.is_admin())
  with check (sgc.is_admin());

alter policy "usuarios: read own" on sgc.usuarios
  using ((id = auth.uid()));

alter policy "usuarios_insert_admin" on sgc.usuarios
  with check (('admin'::text = ANY (sgc.get_user_roles())));

alter policy "usuarios_select_admin" on sgc.usuarios
  using (('admin'::text = ANY (sgc.get_user_roles())));

alter policy "usuarios_select_admin_dev" on sgc.usuarios
  using (sgc.es_desarrollador());

alter policy "usuarios_select_own" on sgc.usuarios
  using ((id = auth.uid()));

alter policy "usuarios_update_admin" on sgc.usuarios
  using (('admin'::text = ANY (sgc.get_user_roles())));

alter policy "usuarios_roles: admin manage" on sgc.usuarios_roles
  using ((sgc.is_admin() OR (usuario_id = auth.uid())))
  with check (sgc.is_admin());

alter policy "usuarios_roles: read own" on sgc.usuarios_roles
  using ((usuario_id = auth.uid()));

alter policy "usuarios_roles_manage_admin" on sgc.usuarios_roles
  using (('admin'::text = ANY (sgc.get_user_roles())));

alter policy "usuarios_roles_select" on sgc.usuarios_roles
  using (((usuario_id = auth.uid()) OR ('admin'::text = ANY (sgc.get_user_roles()))));

alter policy "vef_select" on sgc.vehiculo_entrega_fotos
  using ((EXISTS ( SELECT 1
   FROM sgc.vehiculo_entregas e
  WHERE ((e.id = vehiculo_entrega_fotos.entrega_id) AND ((e.conductor_usuario_id = auth.uid()) OR sgc.tiene_modulo('flota'::text))))));

alter policy "revisor_solo_demo" on sgc.vehiculo_usos
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "vehiculo_usos_read" on sgc.vehiculo_usos
  using (((usuario_id = auth.uid()) OR sgc.es_flota_elevado() OR sgc.es_tecnologia()));
