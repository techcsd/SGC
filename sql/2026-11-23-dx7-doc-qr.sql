-- DX7 (ronda 23-nov-2026) -- QR genérico por tipo de documento (extiende el del conduce, ya en prod desde el 17-nov).
-- Aditivo: interruptor por tipo (APAGADO; Xaviel lo enciende tras probar en dev) + registro de escaneos (quién/cuándo).
-- El conduce conserva `conduce_qr_activo` (encendido). El QR no otorga permisos; solo lleva a la pantalla.
begin;

insert into sgc.parametros (clave, valor, descripcion) values
  ('doc_qr_requisicion_activo', 'false', 'DX7 — QR en el detalle de la requisición (lleva a verla/aprobarla según el rol). Apagado hasta probar.'),
  ('doc_qr_vigencia_dias', '7', 'DX7 — vigencia (días) de los QR de acción distintos del conduce (el conduce usa conduce_qr_vigencia_dias).')
on conflict (clave) do nothing;

create table if not exists sgc.doc_qr_escaneos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,
  doc_id      uuid not null,
  usuario_id  uuid references sgc.usuarios(id) on delete set null,
  resultado   text not null default 'ok',   -- ok | no_encontrado | sin_acceso
  creado_en   timestamptz not null default now()
);
create index if not exists doc_qr_escaneos_doc_idx on sgc.doc_qr_escaneos (tipo, doc_id, creado_en desc);
alter table sgc.doc_qr_escaneos enable row level security;
-- Solo lectura para administración/tecnología (AT11: lo que se registra se puede ver). Escribe únicamente la edge (service_role).
create policy doc_qr_escaneos_sel on sgc.doc_qr_escaneos for select to authenticated
  using ((select sgc.is_admin()) or (select sgc.es_tecnologia()));
grant select on sgc.doc_qr_escaneos to authenticated;
grant select, insert on sgc.doc_qr_escaneos to service_role;
comment on table sgc.doc_qr_escaneos is 'DX7 — quién escaneó el QR de qué documento y cuándo (sin datos personales dentro del token).';

commit;
