-- DX7 (tanda 2) -- QR de la solicitud de compra. Apagado por defecto.
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('doc_qr_solicitud_compra_activo', 'false', 'DX7 — QR de la solicitud de compra (lleva a su atención en Compras › Órdenes). Apagado hasta probar.')
on conflict (clave) do nothing;
commit;
