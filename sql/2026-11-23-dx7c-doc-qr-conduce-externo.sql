-- DX7 (tanda 3) -- QR de la ficha del conduce externo (sale al imprimir). Encendido a pedido de Xaviel («hazlo --yes», 23-nov).
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('doc_qr_conduce_externo_activo', 'true', 'DX7 — QR de la ficha del conduce externo (lleva a Inventario › Conduces externos; el acceso lo decide el rol).')
on conflict (clave) do nothing;
commit;
