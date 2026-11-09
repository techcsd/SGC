-- 2026-11-03-dg5-mas-misiones-app.sql — ronda DG (app), DG5 módulo "Demo"
--
-- Completa el catálogo admin-facing `sgc.practica_misiones` con las 5 misiones
-- nuevas del simulador de la app (`misiones-app.ts`, MISIONES_APP). Mismo patrón
-- que sql/2026-11-02-dg5-mas-datos-demo.sql (web): `mision_id` no tiene FK desde
-- `practica_intentos` (es texto libre) — este insert solo alinea el catálogo con lo
-- que ya corre en la app; aditivo e idempotente (on conflict do nothing).
--
--   node scripts/apply-migration.mjs sql-para-sgc/2026-11-03-dg5-mas-misiones-app.sql --env dev

begin;

insert into sgc.practica_misiones (id, plataforma, roles, titulo, version) values
  ('app-firmar-conduce',   'app', '{chofer}', 'Firmar un conduce', 1),
  ('app-solicitud-compra', 'app', '{ingeniero_campo,ingeniero_oficina,capataz}', 'Pedir solicitud de compra', 1),
  ('app-mantenimiento',    'app', '{jefe_flota,logistica}', 'Registrar mantenimiento', 1),
  ('app-ruta',             'app', '{jefe_flota,logistica}', 'Crear una ruta', 1),
  ('app-orden-trabajo',    'app', '{ingeniero_campo,ingeniero_oficina,capataz}', 'Crear orden de trabajo', 1)
on conflict (id) do nothing;

commit;
