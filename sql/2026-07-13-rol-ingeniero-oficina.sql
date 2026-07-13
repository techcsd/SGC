-- Rol "Ingeniero de Oficina": ingenieros que trabajan en oficina con planos,
-- presupuestos y coordinación de obra (distinto del Ingeniero de Campo, que solo
-- usa bitácora en la app). Acceso: proyectos, documentos, compras, bitácora, tareas.
insert into sgc.roles (codigo, nombre, modulos)
select 'ingeniero_oficina', 'Ingeniero de Oficina',
       array['proyectos','documentos','compras','bitacora','tareas']
where not exists (select 1 from sgc.roles where codigo = 'ingeniero_oficina');
