-- Endurecer: el cuadre de materiales + señales antifraude (límites por fase,
-- consumo) NO deben verlo roles con solo `proyectos` (p.ej. Ingeniero de Oficina
-- o Gerente de Proyectos). Se limita a roles financieros/dirección: compras,
-- direccion o admin. Los RPC (aprobar_requisicion, copiar_kit_a_cuadre) son
-- SECURITY DEFINER, así que siguen registrando consumo sin depender de esto.
alter policy cuadre_obra_all on sgc.cuadre_obra
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'));

alter policy cuadre_items_all on sgc.cuadre_items
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'));

alter policy cuadre_consumo_sel on sgc.cuadre_consumo
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'));
