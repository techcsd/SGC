-- DY (23-nov-2026) -- "No sale combustible" (Corianny, Jefe de RRHH) + misma queja de Yonairy (Asistente administrativa).
--
-- Causa (confirmada leyendo código + capturas): la página /flota/combustible se abre con
-- `submoduloGuard('flota.combustible')` (módulo `flota` o permiso granular), pero la RLS de
-- `registros_combustible` (puede_ver_echada) solo deja leer a flota-elevada / admin / quien registró / el
-- conductor / el que tiene el vehículo. Quien pasa el guard del menú pero no es elevado ve "0 registros".
-- (El aviso "estación caída" y el log salen de RPC definer, por eso mostraban 14.)
--
-- Fix (regla 14: UN predicado): la lectura global de combustible también la da el PERMISO GRANULAR EXPLÍCITO
-- `flota.combustible` = ver|operar en el rol (no el módulo `flota` a secas: choferes y guarda-almacén tienen
-- el módulo y NO deben ver todas las echadas). Se excluye `revisor_tiendas` (cuentas de revisión de Play/Apple:
-- nunca datos reales de combustible).
-- Concede el permiso (solo LECTURA) a: jefe_rrhh (Corianny) y asistente_administrativa (Yonairy).
-- Efecto lateral esperado: `desarrollador` (ya tenía flota.combustible=ver) ahora SÍ lee las echadas, como
-- documenta su rol ("lee lo operativo para depurar"). `logistica` ya era elevada.
-- Aditivo y reversible: sql/_reversa/2026-11-23-dy-combustible-lectura-granular.reversa.sql
begin;
set local lock_timeout = '3s';

create or replace function sgc.puede_leer_combustible_global()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1
      from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
     where ur.usuario_id = auth.uid()
       and coalesce(r.permisos ->> 'flota.combustible', '') in ('ver', 'operar')
       and r.codigo <> 'revisor_tiendas'
  );
$$;
grant execute on function sgc.puede_ver_echada(uuid, uuid) to authenticated, service_role;
grant execute on function sgc.puede_leer_combustible_global() to authenticated, service_role;
comment on function sgc.puede_leer_combustible_global() is
  'DY — lectura global de echadas por permiso granular explícito flota.combustible (ver|operar), excluye revisor_tiendas. Parte del predicado único puede_ver_echada (RLS + echada_detalle).';

-- Predicado único (2 args): lo heredan el overload de 3 args (cd5), la política select y echada_detalle.
create or replace function sgc.puede_ver_echada(p_registrado_por uuid, p_conductor_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.es_flota_elevado() or sgc.is_admin()
      or sgc.puede_leer_combustible_global()
      or p_registrado_por = auth.uid()
      or (p_conductor_id in (select sgc.mis_conductor_ids()));
$$;

-- Permiso granular (SOLO lectura) para los dos roles que lo pidieron. `||` conserva el resto de permisos.
update sgc.roles
   set permisos = coalesce(permisos, '{}'::jsonb) || '{"flota.combustible":"ver"}'::jsonb
 where codigo in ('jefe_rrhh', 'asistente_administrativa')
   and coalesce(permisos ->> 'flota.combustible', '') not in ('ver', 'operar');

commit;
