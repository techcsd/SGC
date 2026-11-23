-- Reversa de DY + DY2: quita el permiso granular concedido (la función ya quedó como CA2 tras DY2).
begin;
update sgc.roles set permisos = permisos - 'flota.combustible' where codigo in ('jefe_rrhh', 'asistente_administrativa');
commit;
