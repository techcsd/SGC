-- DS-46 (#71) lote 3: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: auditoria, agente_eventos, wa_eventos, migraciones_aplicadas, avisos_flota, app_versiones, edges_desplegadas, articulos, incentivo_incidencia_decision, checklist_plantilla_items, odoo_discrepancias, otros_valores, obra_avance_snapshots, parametros, kit_inicio_plantilla, cl_plantilla_items, registros_combustible, documentos, personal_obra, app_error_reports, bitacora_catalogos, boveda_accesos, cl_registro_items, conteo_items, notif_tipo, cronograma_tareas, flota_config, ayuda_contenido, unidades, categorias_inventario, entradas_inventario, tec_equipos, tec_equipo_historial, vehiculos, roles, proyectos, checklist_foto_slots, cl_registro_fotos, proyecto_responsables, audio_notas. Semantica identica; reversa en sql/_reversa/.

alter policy "agente_eventos: ver" on sgc.agente_eventos
  using (((select sgc.is_admin()) OR (select sgc.es_tecnologia())));

alter policy "app_error_reports: read tecnologia" on sgc.app_error_reports
  using ((select sgc.es_tecnologia()));

alter policy "app_versiones_all" on sgc.app_versiones
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "articulos: insert" on sgc.articulos
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "articulos: update" on sgc.articulos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "articulos_manage" on sgc.articulos
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "es_prueba: oculta a no-admin" on sgc.articulos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.articulos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: inventario.articulos" on sgc.articulos
  using (((select sgc.submodulo_nivel_explicito('inventario.articulos'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.articulos" on sgc.articulos
  with check (((select sgc.submodulo_nivel_explicito('inventario.articulos'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.articulos" on sgc.articulos
  using (((select sgc.submodulo_nivel_explicito('inventario.articulos'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.articulos'::text)) = 'operar'::text));

alter policy "submod ver: inventario.articulos" on sgc.articulos
  using (((select sgc.submodulo_nivel_explicito('inventario.articulos'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "audio_notas: delete" on sgc.audio_notas
  using (((creado_por = (select auth.uid())) OR (select sgc.is_admin())));

alter policy "audio_notas: insert" on sgc.audio_notas
  with check ((creado_por = (select auth.uid())));

alter policy "audio_notas: oculta prueba a no-admin" on sgc.audio_notas
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "audio_notas: select" on sgc.audio_notas
  using (((select auth.uid()) IS NOT NULL));

alter policy "revisor_solo_demo" on sgc.audio_notas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "auditoria_select" on sgc.auditoria
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('auditoria'::text))));

alter policy "avisos_flota_all" on sgc.avisos_flota
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "avisos_flota_sel" on sgc.avisos_flota
  using (((select sgc.es_flota_elevado()) OR (conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids))));

alter policy "es_prueba: oculta a no-admin" on sgc.avisos_flota
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.avisos_flota
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "ayuda_contenido: write tecnologia" on sgc.ayuda_contenido
  using ((select sgc.es_tecnologia()))
  with check ((select sgc.es_tecnologia()));

alter policy "bcat_write" on sgc.bitacora_catalogos
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "boveda_accesos_sel" on sgc.boveda_accesos
  using ((select sgc.is_admin()));

alter policy "categorias_manage_admin" on sgc.categorias_inventario
  using (('admin'::text = ANY ((select sgc.get_user_roles())::text[])));

alter policy "chk_foto_slots_all" on sgc.checklist_foto_slots
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "chk_plant_it_all" on sgc.checklist_plantilla_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "chk_plant_it_sel" on sgc.checklist_plantilla_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "cl_plantilla_items_all" on sgc.cl_plantilla_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "cl_plantilla_items_obra" on sgc.cl_plantilla_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_ver_submodulo('obra.checklists'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.checklists'::text))));

alter policy "cl_registro_fotos_all" on sgc.cl_registro_fotos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "cl_registro_fotos_obra" on sgc.cl_registro_fotos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_ver_submodulo('obra.checklists'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.checklists'::text))));

alter policy "cl_registro_items_all" on sgc.cl_registro_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text))));

alter policy "cl_registro_items_obra" on sgc.cl_registro_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_ver_submodulo('obra.checklists'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (select sgc.puede_operar_submodulo('obra.checklists'::text))));

alter policy "conteo_items_select" on sgc.conteo_items
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "submod op-del: inventario.conteos" on sgc.conteo_items
  using (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.conteos" on sgc.conteo_items
  with check (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.conteos" on sgc.conteo_items
  using (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = 'operar'::text));

alter policy "submod ver: inventario.conteos" on sgc.conteo_items
  using (((select sgc.submodulo_nivel_explicito('inventario.conteos'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "cronograma_tareas: select" on sgc.cronograma_tareas
  using ((sgc.puede_ver_cronograma(proyecto_id) AND ((NOT es_prueba) OR (select sgc.is_admin()))));

alter policy "revisor_solo_demo" on sgc.cronograma_tareas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "documentos_del" on sgc.documentos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "documentos_sel" on sgc.documentos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "edges_desplegadas_sel" on sgc.edges_desplegadas
  using ((select sgc.is_admin()));

alter policy "entradas_insert" on sgc.entradas_inventario
  with check ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "entradas_inventario: delete" on sgc.entradas_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "entradas_inventario: insert" on sgc.entradas_inventario
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "entradas_inventario: select" on sgc.entradas_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "entradas_inventario: update" on sgc.entradas_inventario
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "entradas_select" on sgc.entradas_inventario
  using ((('admin'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('logistica'::text = ANY ((select sgc.get_user_roles())::text[])) OR ('gerencia'::text = ANY ((select sgc.get_user_roles())::text[]))));

alter policy "es_prueba: oculta a no-admin" on sgc.entradas_inventario
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.entradas_inventario
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: inventario.entradas" on sgc.entradas_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text));

alter policy "submod op-ins: inventario.entradas" on sgc.entradas_inventario
  with check (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text));

alter policy "submod op-upd: inventario.entradas" on sgc.entradas_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = 'operar'::text));

alter policy "submod ver: inventario.entradas" on sgc.entradas_inventario
  using (((select sgc.submodulo_nivel_explicito('inventario.entradas'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "flota_config_all" on sgc.flota_config
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "inc_incidencia_dec_sel" on sgc.incentivo_incidencia_decision
  using ((select sgc.puede_gestionar_incentivos()));

alter policy "kit_sel" on sgc.kit_inicio_plantilla
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('inventario'::text))));

alter policy "kit_write" on sgc.kit_inicio_plantilla
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "mig_aplicadas_sel" on sgc.migraciones_aplicadas
  using ((select sgc.is_admin()));

alter policy "notif_tipo: admin" on sgc.notif_tipo
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "obra_avance_snapshots_all" on sgc.obra_avance_snapshots
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('obra'::text)) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.puede_operar_submodulo('obra.avance'::text))));

alter policy "obra_avance_snapshots_sel" on sgc.obra_avance_snapshots
  using ((select sgc.puede_ver_submodulo('obra.avance'::text)));

alter policy "odoo_discrepancias_sel" on sgc.odoo_discrepancias
  using ((select sgc.es_tecnologia()));

alter policy "otros_valores_sel" on sgc.otros_valores
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "parametros_sel" on sgc.parametros
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('direccion'::text))));

alter policy "parametros_write" on sgc.parametros
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "revisor_solo_demo" on sgc.personal_obra
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "proyecto_responsables: delete" on sgc.proyecto_responsables
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_responsables: insert" on sgc.proyecto_responsables
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "proyecto_responsables: select" on sgc.proyecto_responsables
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text)) OR (select sgc.tiene_modulo('bitacora'::text)) OR (usuario_id = (select auth.uid()))));

alter policy "proyecto_responsables: update" on sgc.proyecto_responsables
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('proyectos'::text))));

alter policy "es_prueba: oculta a no-admin" on sgc.proyectos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "proyectos: delete" on sgc.proyectos
  using ((select sgc.puede_gestionar_proyectos()));

alter policy "proyectos: insert" on sgc.proyectos
  with check ((select sgc.puede_gestionar_proyectos()));

alter policy "proyectos: update" on sgc.proyectos
  using ((select sgc.puede_gestionar_proyectos()))
  with check ((select sgc.puede_gestionar_proyectos()));

alter policy "revisor_solo_demo" on sgc.proyectos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "es_prueba: oculta a no-admin" on sgc.registros_combustible
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "registros_combustible: delete" on sgc.registros_combustible
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "registros_combustible: insert" on sgc.registros_combustible
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "registros_combustible: update" on sgc.registros_combustible
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "revisor_solo_demo" on sgc.registros_combustible
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: flota.combustible" on sgc.registros_combustible
  using (((select sgc.submodulo_nivel_explicito('flota.combustible'::text)) = 'operar'::text));

alter policy "submod op-ins: flota.combustible" on sgc.registros_combustible
  with check (((select sgc.submodulo_nivel_explicito('flota.combustible'::text)) = 'operar'::text));

alter policy "submod op-upd: flota.combustible" on sgc.registros_combustible
  using (((select sgc.submodulo_nivel_explicito('flota.combustible'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('flota.combustible'::text)) = 'operar'::text));

alter policy "submod ver: flota.combustible" on sgc.registros_combustible
  using (((select sgc.submodulo_nivel_explicito('flota.combustible'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])));

alter policy "roles: admin insert" on sgc.roles
  with check ((select sgc.is_admin()));

alter policy "roles: admin update" on sgc.roles
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "tec_hist_all" on sgc.tec_equipo_historial
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_ver_submodulo('tecnologia.inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "tec_equipos_all" on sgc.tec_equipos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_ver_submodulo('tecnologia.inventario'::text))))
  with check (((select sgc.is_admin()) OR (select sgc.tiene_modulo('tecnologia'::text)) OR (select sgc.puede_operar_submodulo('tecnologia.inventario'::text))));

alter policy "unidades_write" on sgc.unidades
  using ((select sgc.is_admin()))
  with check ((select sgc.is_admin()));

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.vehiculos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "submod op-del: flota.vehiculos" on sgc.vehiculos
  using (((select sgc.submodulo_nivel_explicito('flota.vehiculos'::text)) = 'operar'::text));

alter policy "submod op-ins: flota.vehiculos" on sgc.vehiculos
  with check (((select sgc.submodulo_nivel_explicito('flota.vehiculos'::text)) = 'operar'::text));

alter policy "submod op-upd: flota.vehiculos" on sgc.vehiculos
  using (((select sgc.submodulo_nivel_explicito('flota.vehiculos'::text)) = 'operar'::text))
  with check (((select sgc.submodulo_nivel_explicito('flota.vehiculos'::text)) = 'operar'::text));

alter policy "submod ver: flota.vehiculos" on sgc.vehiculos
  using ((((select sgc.submodulo_nivel_explicito('flota.vehiculos'::text)) = ANY (ARRAY['ver'::text, 'operar'::text])) AND (activo = true)));

alter policy "vehiculos: delete" on sgc.vehiculos
  using ((select sgc.is_admin()));

alter policy "vehiculos: insert" on sgc.vehiculos
  with check ((select sgc.es_flota_elevado()));

alter policy "vehiculos: select" on sgc.vehiculos
  using ((((activo = true) AND (select sgc.tiene_modulo('flota'::text)) AND (COALESCE(visible_choferes, true) OR (NOT (select sgc.es_chofer())))) OR (select sgc.es_flota_elevado())));

alter policy "vehiculos: update" on sgc.vehiculos
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "wa_eventos_sel" on sgc.wa_eventos
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));
