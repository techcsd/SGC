begin;
update sgc.roles set permisos = permisos - 'flota.vehiculos' - 'flota.conductores' where codigo in ('jefe_rrhh', 'asistente_administrativa');
commit;
