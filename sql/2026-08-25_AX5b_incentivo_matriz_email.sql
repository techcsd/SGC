-- ============================================================================
-- AX5 — RPC interno para el correo del incentivo. Devuelve la MISMA matriz
-- detallada que el módulo (conteos por renglón + flags), pero:
--   • sin el guard de UI `puede_gestionar_incentivos()` (lo llama la edge
--     function con service role, contexto server-to-server ya confiable);
--   • gate por rol chofer_transportista (población correcta, AX5);
--   • excluye choferes de prueba (conductores.es_prueba) — correo real.
-- Así el correo reusa la misma fuente que la pantalla (integridad AU1) sin
-- aflojar el guard del módulo.
-- ============================================================================
CREATE OR REPLACE FUNCTION sgc.incentivo_matriz_email(p_anio integer, p_semana integer)
 RETURNS TABLE(nombre text, puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
  select u.nombre, s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags, v.decision
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
   where s.anio = p_anio and s.semana = p_semana
     and exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = s.usuario_id and r.codigo = 'chofer_transportista')
     and not exists (select 1 from sgc.conductores c
                     where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;
