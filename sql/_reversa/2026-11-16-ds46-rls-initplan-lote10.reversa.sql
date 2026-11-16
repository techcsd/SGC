-- Reversa de DS-46 lote 10: restaura las expresiones originales de las politicas.

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculo_accidentes
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.vehiculo_accidentes
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "va_delete" on sgc.vehiculo_accidentes
  using (sgc.es_flota_elevado());

alter policy "va_insert" on sgc.vehiculo_accidentes
  with check ((sgc.es_flota_elevado() OR (creado_por = auth.uid())));

alter policy "va_select" on sgc.vehiculo_accidentes
  using ((sgc.es_flota_elevado() OR (conductor_id IN ( SELECT conductores.id
   FROM sgc.conductores
  WHERE (conductores.usuario_id = auth.uid())))));

alter policy "va_write" on sgc.vehiculo_accidentes
  using (sgc.es_flota_elevado())
  with check (sgc.es_flota_elevado());

alter policy "vehiculo_autorizaciones_select" on sgc.vehiculo_autorizaciones
  using (((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.es_flota_elevado()));

alter policy "vehiculo_autorizaciones_write" on sgc.vehiculo_autorizaciones
  using ((sgc.is_admin() OR sgc.es_flota_elevado()))
  with check ((sgc.is_admin() OR sgc.es_flota_elevado()));

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculo_danos
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.vehiculo_danos
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "vd_delete" on sgc.vehiculo_danos
  using (sgc.es_flota_elevado());

alter policy "vd_insert" on sgc.vehiculo_danos
  with check ((sgc.es_flota_elevado() OR (reportado_por = auth.uid())));

alter policy "vd_select" on sgc.vehiculo_danos
  using ((sgc.es_flota_elevado() OR (reportado_por = auth.uid())));

alter policy "vd_write" on sgc.vehiculo_danos
  using (sgc.es_flota_elevado())
  with check (sgc.es_flota_elevado());

alter policy "ved_select" on sgc.vehiculo_entrega_danos
  using ((EXISTS ( SELECT 1
   FROM sgc.vehiculo_entregas e
  WHERE ((e.id = vehiculo_entrega_danos.entrega_id) AND ((e.conductor_usuario_id = auth.uid()) OR sgc.tiene_modulo('flota'::text))))));

alter policy "es_prueba: oculta a no-admin" on sgc.vehiculo_entregas
  using (((NOT es_prueba) OR sgc.is_admin() OR sgc.usuario_actual_es_prueba()));

alter policy "revisor_solo_demo" on sgc.vehiculo_entregas
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "ve_select" on sgc.vehiculo_entregas
  using ((sgc.es_flota_elevado() OR (conductor_usuario_id = auth.uid()) OR (creado_por = auth.uid())));

alter policy "vehiculo_llave_traspasos: read" on sgc.vehiculo_llave_traspasos
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "vehiculo_llaves: read" on sgc.vehiculo_llaves
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text)));

alter policy "placa_pp_ext_all" on sgc.vehiculo_placa_pp_extensiones
  using (sgc.es_flota_elevado())
  with check (sgc.es_flota_elevado());

alter policy "placas_pp es_prueba" on sgc.vehiculo_placas_pp
  using (((NOT es_prueba) OR sgc.is_admin()));

alter policy "placas_pp_all" on sgc.vehiculo_placas_pp
  using (sgc.es_flota_elevado())
  with check (sgc.es_flota_elevado());

alter policy "revisor_solo_demo" on sgc.vehiculo_placas_pp
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "revisor_solo_demo" on sgc.vehiculo_traspaso_actas
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "veh_traspaso_actas: read" on sgc.vehiculo_traspaso_actas
  using ((sgc.is_admin() OR sgc.tiene_modulo('flota'::text) OR (de_usuario_id = auth.uid()) OR (a_usuario_id = auth.uid())));

alter policy "revisor_solo_demo" on sgc.viajes_transporte
  using (((NOT sgc.es_revisor_tiendas()) OR es_prueba));

alter policy "wa_config_sel" on sgc.wa_config
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_config_upd" on sgc.wa_config
  using (sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text))
  with check (sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_grupo_destinatarios_sel" on sgc.wa_grupo_destinatarios
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_grupos_sel" on sgc.wa_grupos
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_grupos_upd" on sgc.wa_grupos
  using (sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text))
  with check (sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_hallazgos_sel" on sgc.wa_hallazgos
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_hallazgos_upd" on sgc.wa_hallazgos
  using (sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text))
  with check (sgc.puede_operar_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_mensajes_grupo_sel" on sgc.wa_mensajes_grupo
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_recap_envios_sel" on sgc.wa_recap_envios
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_recordatorios_sel" on sgc.wa_recordatorios
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));

alter policy "wa_resumenes_sel" on sgc.wa_resumenes
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'::text));
