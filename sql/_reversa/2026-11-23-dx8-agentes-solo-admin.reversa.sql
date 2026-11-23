-- Reversa DX8: vuelve a is_admin() OR es_tecnologia().
begin;
alter policy "agentes: ver" on sgc.agentes using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));
alter policy "agente_eventos: ver" on sgc.agente_eventos using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));
alter policy "agente_hallazgos: ver" on sgc.agente_hallazgos using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));
alter policy "agente_acciones: ver" on sgc.agente_acciones using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));
alter policy "agente_aprobaciones: ver" on sgc.agente_aprobaciones using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));
alter policy "agente_informes_diarios: ver" on sgc.agente_informes_diarios using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));
alter policy "agente_aprobaciones: decidir" on sgc.agente_aprobaciones using (((select sgc.is_admin()) or (select sgc.es_tecnologia())));

CREATE OR REPLACE FUNCTION sgc.agente_informe_enviar(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_fecha date;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  update sgc.agente_informes_diarios
     set enviado_en = now()
   where id = p_id and enviado_en is null
  returning fecha into v_fecha;
  if not found then
    raise exception 'informe_ya_enviado_o_inexistente' using errcode = 'P0002';
  end if;
  perform sgc.notificar_rol(
    r, 'agente_informe_diario',
    'Informe diario de Tecnología — ' || to_char(v_fecha, 'dd/mm/yyyy'),
    'El Cronista armó el resumen del día. Revísalo en Tecnología › Agentes.',
    '/tecnologia/agentes'
  )
  from unnest(sgc.param_csv('agente_informe_diario_roles', 'direccion')) as r;
end;
$function$

;
CREATE OR REPLACE FUNCTION sgc.decidir_agente_aprobacion(p_id uuid, p_decision text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if p_decision not in ('aprobada','ajuste','descartada') then
    raise exception 'decision_invalida' using errcode = '22023';
  end if;
  update sgc.agente_aprobaciones
     set estado = p_decision,
         decidida_por = auth.uid(),
         decidida_en = now(),
         propuesta = case when p_decision = 'ajuste' and p_nota is not null
                          then propuesta || E'\n\n[Ajuste pedido] ' || p_nota
                          else propuesta end
   where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'aprobacion_no_pendiente' using errcode = 'P0002';
  end if;
end;
$function$

;
CREATE OR REPLACE FUNCTION sgc.deshacer_agente_accion(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  update sgc.agente_acciones
     set deshecha_en = now()
   where id = p_id and reversible = true and deshecha_en is null;
  if not found then
    raise exception 'accion_no_deshacible' using errcode = 'P0002';
  end if;
end;
$function$;
commit;
