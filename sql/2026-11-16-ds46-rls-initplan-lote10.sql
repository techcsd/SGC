-- DS-46 (#71) lote 10: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.
-- Tablas: vehiculo_accidentes, vehiculo_autorizaciones, vehiculo_danos, vehiculo_entrega_danos, vehiculo_entregas, vehiculo_llave_traspasos, vehiculo_llaves, vehiculo_placa_pp_extensiones, vehiculo_placas_pp, vehiculo_traspaso_actas, viajes_transporte, wa_config, wa_grupo_destinatarios, wa_grupos, wa_hallazgos, wa_mensajes_grupo, wa_recap_envios, wa_recordatorios, wa_resumenes. Semantica identica; reversa en sql/_reversa/.

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculo_accidentes
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.vehiculo_accidentes
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "va_delete" on sgc.vehiculo_accidentes
  using ((select sgc.es_flota_elevado()));

alter policy "va_insert" on sgc.vehiculo_accidentes
  with check (((select sgc.es_flota_elevado()) OR (creado_por = (select auth.uid()))));

alter policy "va_select" on sgc.vehiculo_accidentes
  using (((select sgc.es_flota_elevado()) OR (conductor_id IN ( SELECT conductores.id
   FROM sgc.conductores
  WHERE (conductores.usuario_id = (select auth.uid()))))));

alter policy "va_write" on sgc.vehiculo_accidentes
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "vehiculo_autorizaciones_select" on sgc.vehiculo_autorizaciones
  using (((usuario_id = (select auth.uid())) OR (select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "vehiculo_autorizaciones_write" on sgc.vehiculo_autorizaciones
  using (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())))
  with check (((select sgc.is_admin()) OR (select sgc.es_flota_elevado())));

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculo_danos
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.vehiculo_danos
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "vd_delete" on sgc.vehiculo_danos
  using ((select sgc.es_flota_elevado()));

alter policy "vd_insert" on sgc.vehiculo_danos
  with check (((select sgc.es_flota_elevado()) OR (reportado_por = (select auth.uid()))));

alter policy "vd_select" on sgc.vehiculo_danos
  using (((select sgc.es_flota_elevado()) OR (reportado_por = (select auth.uid()))));

alter policy "vd_write" on sgc.vehiculo_danos
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "ved_select" on sgc.vehiculo_entrega_danos
  using ((EXISTS ( SELECT 1
   FROM sgc.vehiculo_entregas e
  WHERE ((e.id = vehiculo_entrega_danos.entrega_id) AND ((e.conductor_usuario_id = (select auth.uid())) OR (select sgc.tiene_modulo('flota'::text)))))));

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculo_entregas
  using (((NOT es_prueba) OR (select sgc.is_admin()) OR (select sgc.usuario_actual_es_prueba())));

alter policy "revisor_solo_demo" on sgc.vehiculo_entregas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "ve_select" on sgc.vehiculo_entregas
  using (((select sgc.es_flota_elevado()) OR (conductor_usuario_id = (select auth.uid())) OR (creado_por = (select auth.uid()))));

alter policy "vehiculo_llave_traspasos: read" on sgc.vehiculo_llave_traspasos
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "vehiculo_llaves: read" on sgc.vehiculo_llaves
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text))));

alter policy "placa_pp_ext_all" on sgc.vehiculo_placa_pp_extensiones
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "placas_pp es_prueba" on sgc.vehiculo_placas_pp
  using (((NOT es_prueba) OR (select sgc.is_admin())));

alter policy "placas_pp_all" on sgc.vehiculo_placas_pp
  using ((select sgc.es_flota_elevado()))
  with check ((select sgc.es_flota_elevado()));

alter policy "revisor_solo_demo" on sgc.vehiculo_placas_pp
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.vehiculo_traspaso_actas
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "veh_traspaso_actas: read" on sgc.vehiculo_traspaso_actas
  using (((select sgc.is_admin()) OR (select sgc.tiene_modulo('flota'::text)) OR (de_usuario_id = (select auth.uid())) OR (a_usuario_id = (select auth.uid()))));

alter policy "revisor_solo_demo" on sgc.viajes_transporte
  using (((NOT (select sgc.es_revisor_tiendas())) OR es_prueba));

alter policy "wa_config_sel" on sgc.wa_config
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_config_upd" on sgc.wa_config
  using ((select sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text)))
  with check ((select sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_grupo_destinatarios_sel" on sgc.wa_grupo_destinatarios
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_grupos_sel" on sgc.wa_grupos
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_grupos_upd" on sgc.wa_grupos
  using ((select sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text)))
  with check ((select sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_hallazgos_sel" on sgc.wa_hallazgos
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_hallazgos_upd" on sgc.wa_hallazgos
  using ((select sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text)))
  with check ((select sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_mensajes_grupo_sel" on sgc.wa_mensajes_grupo
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_recap_envios_sel" on sgc.wa_recap_envios
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_recordatorios_sel" on sgc.wa_recordatorios
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));

alter policy "wa_resumenes_sel" on sgc.wa_resumenes
  using ((select sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text)));
