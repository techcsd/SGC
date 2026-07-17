-- 2026-07-16 · Roles: columna descripción + seed de descripciones claras por rol
-- Aditivo y retrocompatible. Objetivo: que el admin entienda de un vistazo qué hace
-- cada rol, a quién dárselo y a qué da acceso. La UI de admin/roles la muestra y edita.

-- 1) Columna descripción (nullable, aditiva)
alter table sgc.roles add column if not exists descripcion text;

comment on column sgc.roles.descripcion is
  'Explicación legible del rol: qué hace, para quién y cuándo asignarlo. Editable desde admin/roles.';

-- 2) Seed de descripciones por código (solo rellena si está vacía; no pisa ediciones del admin)
update sgc.roles set descripcion = v.descripcion
from (values
  ('admin',
   'Acceso total al sistema: usuarios, roles y permisos, versiones de la app, auditoría y todos los módulos operativos. Asígnalo solo a Tecnología o administradores de confianza — es el nivel máximo de acceso.'),
  ('direccion',
   'Dirección General: acceso operativo amplio (inventario, compras, RRHH, proyectos, flota, bitácora, documentos, legal y tareas) más la vista ejecutiva. Para la alta dirección que necesita ver todo sin administrar el sistema.'),
  ('gerencia',
   'Vista gerencial: inventario, compras, RRHH, proyectos y flota, más la vista ejecutiva de Dirección. Para gerentes que supervisan varias áreas pero no administran usuarios ni permisos.'),
  ('gerente_proyectos',
   'Proyectos y obras: partidas planeadas, avance físico, pagado vs trabajado y ranking de encargados. Para quien dirige la ejecución de las obras.'),
  ('ingeniero_oficina',
   'Ingeniería desde la oficina: proyectos, documentos, compras, bitácora y asignación de tareas. Para ingenieros que apoyan las obras desde la oficina.'),
  ('ingeniero_campo',
   'Bitácora de obra: parte diario, visitas e incidentes. Para ingenieros y encargados que reportan el día a día desde la obra.'),
  ('jefe_flota',
   'Flota completa: vehículos y conductores, pre-uso, reporte semanal, combustible, mantenimientos por km, rutas y avisos de flota. Para el responsable del parque vehicular.'),
  ('chofer_transportista',
   'Flota desde el campo: elegir un vehículo del pool, pre-uso, reporte semanal, combustible y rutas — se usa sobre todo desde la app móvil. Para choferes y transportistas.'),
  ('coord_compras',
   'Compras e inventario: solicitudes y órdenes de compra a proveedores y el inventario asociado. Para quien coordina las compras de la empresa.'),
  ('logistica',
   'Logística y transporte con foco en inventario: almacenes, entradas/salidas, conduces y movimientos de material. Para el personal de logística.'),
  ('guarda_almacen',
   'Inventario de un almacén: recibe y entrega materiales, genera conduces y hace conteos. Para el guarda-almacén.'),
  ('jefe_rrhh',
   'Recursos Humanos: empleados, asistencia, ausencias y vacaciones, y documentos de personal. Para el encargado de RRHH.'),
  ('abogado',
   'Área legal: expedientes, contratos y aprobaciones, más el uso y creación de plantillas de documentos. Para el rol jurídico.'),
  ('encargado_tecnologia',
   'Tecnología: inventario tecnológico, equipos y herramientas de TI y la matriz tecnológica. Para el encargado de Tecnología.')
) as v(codigo, descripcion)
where sgc.roles.codigo = v.codigo
  and (sgc.roles.descripcion is null or btrim(sgc.roles.descripcion) = '');
