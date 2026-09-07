-- ============================================================================
-- BJ3 — Encender el conduce en la web (existe y estaba apagado).
--
-- (1) El feature-flag `conduce_wizard_web_habilitado` NUNCA existió como fila en
--     sgc.parametros → SalidasService.wizardConduceHabilitado() devolvía false
--     ante "no encontrado". PEOR: la política SELECT de sgc.parametros solo deja
--     leer a is_admin()/tiene_modulo('direccion') (2026-07-12-alertas-antifraude),
--     así que un CHOFER o un usuario de almacén — justo los que crean conduces —
--     NO pueden leer el parámetro aunque exista → el gate quedaba apagado para
--     ellos por RLS, no por el valor.
--
--     FIX: (a) crear la fila (valor 'true' — el feature se ENCIENDE); (b) leer el
--     flag por un RPC SECURITY DEFINER (`conduce_wizard_web_habilitado()`) que
--     expone SOLO este booleano a cualquier authenticated, sin abrir la tabla
--     parametros. Retiro del flag: cuando el flujo esté verificado en prod, se
--     quita el gate del front y esta fila pasa a ser no-op (ver PARIDAD.md).
--
-- (4) Camino único de escritura (AU1) EN LA WEB: el wrapper TS
--     SalidasService.crearConduceSimple() tiene CERO llamadores → se borra del
--     front. La RPC sgc.crear_conduce_simple() SÍ sigue viva: la invocan otros
--     RPCs server-side (crear_conduce_devolucion_suplidor en am1, y el flujo AL10
--     de Bodega Central) — NO se dropea. El único camino de creación de conduce
--     desde la web es `registrar_salida_inventario` (SalidasService.create).
-- ============================================================================

begin;
set local search_path = sgc, public;

-- (1a) La fila del flag — ENCENDIDO. Idempotente; no pisa un valor ya editado.
insert into sgc.parametros (clave, valor, descripcion) values
  ('conduce_wizard_web_habilitado', 'true',
   'BJ3: habilita el flujo de conduce (despachante + chofer/vehículo + foto) en la web. Retirar el gate cuando esté verificado en prod.')
on conflict (clave) do nothing;

-- (1b) Lector del flag para TODOS (bypassa la RLS de parametros de forma acotada).
create or replace function sgc.conduce_wizard_web_habilitado()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(
    (select lower(p.valor) = 'true' from sgc.parametros p
      where p.clave = 'conduce_wizard_web_habilitado'),
    false);
$$;
grant execute on function sgc.conduce_wizard_web_habilitado() to authenticated, service_role;

commit;
