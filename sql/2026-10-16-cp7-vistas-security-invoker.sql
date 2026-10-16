-- CP7 — Supabase lint "Security Definer View" en sgc.v_incentivo_decision_vigente
-- y sgc.v_conciliacion_factura_vigente: antes de Postgres 15 (y sin el flag
-- explícito) una vista corre con los permisos del DUEÑO (se salta RLS de quien
-- consulta). Las demás 11 vistas de sgc ya tienen security_invoker=true (CA2
-- en adelante) — estas 2 quedaron atrás.
--
-- Consumidores verificados (ningún cambio de comportamiento esperado):
--  - v_incentivo_decision_vigente: SOLO la leen funciones `security definer`
--    (incentivo_listado, incentivo_matriz_email, incentivo_mi_rendimiento, …) —
--    corren con los permisos del dueño de las funciones (postgres, dueño de las
--    tablas sgc), que ya bypassa RLS por ser dueño de la tabla. No hay pantalla
--    que la lea directo → se le quita el grant a `authenticated` (venía de un
--    grant genérico, no de esta migración).
--  - v_conciliacion_factura_vigente: la leen DIRECTO `combustible-conciliacion.
--    service.ts` y `flota/conciliacion-combustible` (usuarios flota-elevado/
--    admin, gateados por el módulo igual que la tabla base vía RLS "concil:
--    elevado"). Con security_invoker=true, la RLS de la tabla base
--    `conciliaciones_combustible` aplica igual — el filtro es por ROL, no por
--    fila, así que un usuario flota-elevado/admin sigue viendo exactamente lo
--    mismo; alguien sin ese rol, que antes podía leer la vista completa
--    saltándose la RLS, ahora no ve nada. Se mantiene el grant a `authenticated`
--    porque la pantalla la necesita.
--
-- Entorno: dev primero (regla 18), luego prod.

alter view sgc.v_incentivo_decision_vigente set (security_invoker = true);
revoke all on sgc.v_incentivo_decision_vigente from anon;
revoke select on sgc.v_incentivo_decision_vigente from authenticated;

alter view sgc.v_conciliacion_factura_vigente set (security_invoker = true);
revoke all on sgc.v_conciliacion_factura_vigente from anon;
grant select on sgc.v_conciliacion_factura_vigente to authenticated;
