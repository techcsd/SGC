-- DY3 (23-nov-2026) -- complemento de DY: con solo flota.combustible=ver la lista de combustible se abre pero
-- la placa y el conductor de cada echada salen vacíos (las políticas "submod ver: flota.vehiculos" y
-- "...flota.conductores" usan el nivel EXPLÍCITO, que Corianny/Yonairy no tienen). Se concede SOLO LECTURA
-- de vehículos y conductores a jefe_rrhh y asistente_administrativa para que "Registro" muestre placa y
-- conductor y el filtro por vehículo funcione. Aditivo; reversa: sql/_reversa/…dy3….reversa.sql
begin;
update sgc.roles
   set permisos = coalesce(permisos, '{}'::jsonb)
       || case when coalesce(permisos ->> 'flota.vehiculos', '')   in ('ver','operar') then '{}'::jsonb else '{"flota.vehiculos":"ver"}'::jsonb end
       || case when coalesce(permisos ->> 'flota.conductores', '') in ('ver','operar') then '{}'::jsonb else '{"flota.conductores":"ver"}'::jsonb end
 where codigo in ('jefe_rrhh', 'asistente_administrativa');
commit;
