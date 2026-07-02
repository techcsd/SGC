-- Two bugs found after the Bitácora rollout:
--
-- 1. The 'admin' role's modulos array was never updated when 'bitacora' was
--    added as a module, so admins couldn't see the new nav section at all.
--    (This exact gotcha is already documented at the top of proyectos.service.ts
--    from an earlier module addition — missed it this time.)
update sgc.roles set modulos = array['inventario','compras','rrhh','proyectos','flota','bitacora','admin']
  where codigo = 'admin';

-- 2. solicitudes_material / solicitudes_compra each have TWO foreign keys to
--    usuarios (solicitante_id and atendido_por), so any PostgREST embed of
--    `usuarios(...)` without disambiguation fails with "more than one
--    relationship was found". Fixed on the client side (explicit !fkey_name),
--    nothing to do here — this comment just documents why.
