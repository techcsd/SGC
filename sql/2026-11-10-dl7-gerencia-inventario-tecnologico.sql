-- =============================================================================
-- DL7 (ronda DL, 10-nov-2026) — N6a: Eduardo NG (rol Gerencia) no veía el
-- submódulo "Inventario tecnológico" ni el grupo de menú "Tecnología".
--
-- F0 de esta ronda confirmó con datos reales (dev, query §5.9) que NINGUNO de
-- los 3 roles de Eduardo (gerencia, gerente_proyectos, ingeniero_campo) tiene
-- el módulo `tecnologia` en `roles.modulos` ni `tecnologia.inventario` en
-- `roles.permisos`. El código del menú (`shell.ts:789-813`) y la RLS
-- (`sql/2026-08-05-ag12-permisos-granulares.sql`) leen el mismo dato: es
-- coherente, el dato real simplemente no lo incluye (H1/H3 de
-- CONTEXTO-ACTUALIZACION-68.md §2.7).
--
-- Esta migración SOLO añade `tecnologia.inventario: ver` al rol Gerencia
-- (fusiona con `||`, nunca pisa lo existente). NO se otorga el módulo
-- `tecnologia` completo: eso abriría Homologación, Matriz, Monitoreo y APIs,
-- que Gerencia no pidió. Aditiva e idempotente.
-- =============================================================================
begin;
set local search_path = sgc, public;

update sgc.roles
set permisos = permisos || '{"tecnologia.inventario":"ver"}'::jsonb
where codigo = 'gerencia'
  and coalesce(permisos->>'tecnologia.inventario', '') <> 'ver';

commit;
