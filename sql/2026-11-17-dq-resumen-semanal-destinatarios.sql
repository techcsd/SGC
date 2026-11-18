-- 2026-11-17 -- #79: el resumen semanal de operaciones debe llegar tambien a RRHH y a los Jefes de Ingenieros (antes: admin, direccion, gerencia, logistica, jefe_flota).
update sgc.parametros set valor = 'admin,direccion,gerencia,logistica,jefe_flota,jefe_rrhh,jefe_ingenieros', updated_at = now()
 where clave = 'resumen_operaciones_roles' and valor = 'admin,direccion,gerencia,logistica,jefe_flota';
