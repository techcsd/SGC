-- BQ4 — Rol "Encargado de Patio y Bodega Central" (El flaco)  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- Recibe mercancía, carga camiones a obra, administra la Bodega Central, gestiona el
-- personal del patio y su asistencia.  §F-5 (decisión Xaviel) = inventario + personal
-- + asistencia.  Los dos últimos son GRANULARES (no le damos Proyectos ni RRHH
-- enteros): el módulo padre en modulos[] otorgaría 'operar' en TODOS sus submódulos
-- (ver nivel_submodulo), así que van por roles.permisos:
--   modulos = ['inventario']
--   permisos = {"proyectos.personal":"operar","rrhh.asistencia":"operar"}
-- Idempotente.  Validar begin/rollback.  Aplicar con OK.
-- ---------------------------------------------------------------------------------

insert into sgc.roles (codigo, nombre, descripcion, modulos, permisos, es_operativo)
values (
  'encargado_patio',
  'Encargado de Patio y Bodega Central',
  'Recibe y despacha mercancía en la Bodega Central, carga los camiones que salen a obra, y gestiona el personal del patio y su asistencia.',
  array['inventario']::text[],
  '{"proyectos.personal":"operar","rrhh.asistencia":"operar"}'::jsonb,
  true
)
on conflict (codigo) do update
  set nombre      = excluded.nombre,
      descripcion = excluded.descripcion,
      modulos     = excluded.modulos,
      permisos    = excluded.permisos;

-- Responsable de bodega (BK1): permite dirigir "llegó un conduce a confirmar" al
-- encargado de la bodega destino en vez de a todo inventario.
alter table sgc.bodegas
  add column if not exists encargado_id uuid references sgc.usuarios(id);
comment on column sgc.bodegas.encargado_id is
  'BQ4 — usuario encargado de esta bodega; destinatario preferente de sus notificaciones de confirmación/entrega.';
