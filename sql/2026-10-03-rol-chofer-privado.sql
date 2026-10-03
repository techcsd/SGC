-- Rol "Chofer privado" — choferes personales de la gerencia (vehículo privado).
-- -------------------------------------------------------------------------------------
-- A pedido de Xaviel: registrar choferes privados (personales de gerencia). Se comportan
-- como un chofer (experiencia de app, registran combustible de su vehículo) PERO quedan
-- FUERA de la rotación operativa de flota (no reciben alarmas de "actualiza tu estado" ni
-- se ofrecen como choferes de ruta de la empresa). Por eso: es_operativo=false (no entra a
-- es_usuario_operativo_flota) + modulos=['flota'] + es_chofer() ampliado (misma piel de app).
-- -------------------------------------------------------------------------------------

-- Submódulos de flota a los que accede (solo los suyos, scope por vehículo vía
-- puede_ver_vehiculo): Vehículos + Checklists + Inspección (flota.vehiculos), Combustible
-- (flota.combustible) y Rutas (flota.rutas) — para crearse sus propias rutas. Los
-- accidentes de su vehículo los reporta desde la app (flujo del chofer). NO transporte
-- (logística de empresa) ni conductores/seguimiento/conciliación (flota elevado).
insert into sgc.roles (codigo, nombre, descripcion, modulos, es_operativo, comparte_ubicacion, permisos)
values (
  'chofer_privado', 'Chofer privado',
  'Chofer personal de gerencia (vehículo privado): usa la app con acceso a Vehículos, Combustible, Rutas, Checklists e Inspección de SU vehículo; fuera de la rotación operativa de flota.',
  array['flota']::text[], false, false,
  '{"flota.vehiculos":"operar","flota.combustible":"operar","flota.rutas":"operar"}'::jsonb
)
on conflict (codigo) do nothing;

-- Idempotente: asegura los submódulos aunque el rol ya existiera (re-aplicación en dev).
update sgc.roles
   set permisos = '{"flota.vehiculos":"operar","flota.combustible":"operar","flota.rutas":"operar"}'::jsonb,
       modulos  = array['flota']::text[],
       descripcion = 'Chofer personal de gerencia (vehículo privado): usa la app con acceso a Vehículos, Combustible, Rutas, Checklists e Inspección de SU vehículo; fuera de la rotación operativa de flota.'
 where codigo = 'chofer_privado';

-- El chofer privado tiene la MISMA experiencia de app que el transportista (bloqueado del
-- panel web, Tecnología oculto): se añade a es_chofer().
create or replace function sgc.es_chofer()
 returns boolean
 language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select exists (select 1 from sgc.incentivo_participante ip
                 where ip.usuario_id = auth.uid() and ip.es_chofer)
      or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo in ('chofer_transportista','chofer_privado'));
$function$;
