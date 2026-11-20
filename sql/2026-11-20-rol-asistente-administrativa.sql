-- Rol "Asistente administrativa" — apoyo a Contabilidad, Compras y trámites administrativos (TSS, RRHH).
-- Hotfix pedido por Xaviel (alta de Yonairy Linarez). No existe módulo "contabilidad": se cubre con
-- Compras (completo) + RRHH NO sensible + Documentos + Tareas. Nómina, contratos, disciplina,
-- evaluaciones y beneficios (datos sensibles RRHH) NO se conceden; se pueden añadir desde Administración.
insert into sgc.roles (codigo, nombre, descripcion, modulos, es_operativo, comparte_ubicacion, permisos)
values (
  'asistente_administrativa', 'Asistente administrativa',
  'Apoyo administrativo a Contabilidad, Compras y RRHH: solicitudes y órdenes de compra, proveedores, empleados, asistencia, ausencias, trámites (TSS), gastos, activos y reportes. Sin nómina ni datos sensibles de RRHH.',
  array['compras','rrhh','documentos','tareas']::text[], false, false,
  '{"compras.proveedores":"operar","compras.ordenes":"operar","compras.solicitudes":"operar",
    "rrhh.empleados":"operar","rrhh.asistencia":"operar","rrhh.ausencias":"operar",
    "rrhh.tramites":"operar","rrhh.gastos":"operar","rrhh.proveedores":"operar",
    "rrhh.activos":"operar","rrhh.tablero":"ver","rrhh.reportes":"ver"}'::jsonb
)
on conflict (codigo) do nothing;
