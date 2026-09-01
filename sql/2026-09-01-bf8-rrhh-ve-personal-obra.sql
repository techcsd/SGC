-- ============================================================================
-- BF8 — Personal de obra en la web: ya EXISTE y es un SUPERSET de la app (wizard
--   Datos→Fotos→Firma→Carnet→Resumen + expediente con carnet/QR/PIN/aseguramiento
--   + import Excel AT5 + ciclo de listados AV4 + merge de contratos AZ1 + acceso
--   capataz AX2). Ruta /proyectos/personal (proyectos.routes.ts), entrada en el
--   sidebar (shell.ts), backend compartido con la app (sgc.personal_obra + RPCs).
--
-- LA BRECHA REAL no era código faltante: era VISIBILIDAD. "Personal de obra" vive
--   bajo el dominio Proyectos (un solo hogar, decisión AU1) y se gatea por el
--   submódulo `proyectos.personal`. RRHH — que es DONDE se trabaja el personal —
--   tiene el módulo `rrhh` pero NO ese submódulo, así que no lo veía. El admin y
--   los roles de Proyectos sí lo ven (ya lo tenían).
--
-- FIX: conceder `proyectos.personal` (operar) a todo rol con el módulo `rrhh`.
--   El grupo Proyectos del sidebar aparece con cualquiera de sus submódulos
--   (shell.ts:220), así que RRHH pasa a ver Proyectos › Personal de obra y entra
--   por el submoduloGuard. Aditivo (permisos jsonb solo SUMA, nunca quita — AG12).
-- ============================================================================

begin;
set local search_path = sgc, public;

update sgc.roles
set permisos = coalesce(permisos, '{}'::jsonb) || '{"proyectos.personal":"operar"}'::jsonb
where 'rrhh' = any(modulos)
  and coalesce(permisos->>'proyectos.personal', '') <> 'operar';

commit;
