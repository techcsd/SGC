-- =============================================================================
-- PROMPT-10 FASE 2 (AH4) — firmar_conduce debe aceptar el rol 'transportista'.
-- La migración de PROMPT-9 (ah4-ah5) amplió el CHECK de sgc.salida_firmas.rol a
-- ('emisor','receptor','transportista') pero NO actualizó el guard de firmar_conduce,
-- que sigue rechazando cualquier rol distinto de emisor/receptor. Sin esto, la
-- segunda firma (chofer que transporta) del wizard de emisión falla. Aditivo:
-- solo se amplía el guard; el rol 'transportista' se comporta como 'emisor' (solo
-- registra la firma, sin la lógica de cierre de pendiente propia del 'receptor').
-- =============================================================================

begin;

create or replace function sgc.firmar_conduce(p_salida_id uuid, p_rol text, p_nombre text, p_firma_path text, p_cedula text default null::text, p_rol_desc text default null::text, p_metodo text default 'pad'::text, p_usuario_id uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
  v_pend uuid;
  v_pend_alm boolean;
  v_creador uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor','transportista') then raise exception 'Rol de firma inválido'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El nombre de quien firma es obligatorio'; end if;
  if nullif(p_firma_path,'') is null then raise exception 'Falta la imagen de la firma'; end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.salidas_inventario s
      where s.id = p_salida_id
        and (s.creado_por = v_uid
             or s.firma_pendiente_usuario_id = v_uid
             or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid))
    )
  ) then
    raise exception 'No tienes permiso para firmar este conduce';
  end if;

  if v_rol = 'receptor' then
    select firma_pendiente_usuario_id, firma_pendiente_almacen, creado_por
      into v_pend, v_pend_alm, v_creador
      from sgc.salidas_inventario where id = p_salida_id;
  end if;

  insert into sgc.salida_firmas (salida_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
  values (p_salida_id, v_rol, trim(p_nombre), nullif(p_cedula,''), nullif(p_rol_desc,''),
          coalesce(p_usuario_id, case when v_rol='receptor' then v_uid else null end), p_firma_path,
          coalesce(nullif(p_metodo,''),'pad'))
  on conflict (salida_id, rol) do update
    set nombre = excluded.nombre, cedula = excluded.cedula, rol_desc = excluded.rol_desc,
        usuario_id = excluded.usuario_id, firma_path = excluded.firma_path,
        metodo = excluded.metodo, firmado_en = now()
  returning id into v_id;

  if v_rol = 'receptor' then
    update sgc.salidas_inventario
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null, firma_pendiente_almacen = false
     where id = p_salida_id;

    if (v_pend is not null or coalesce(v_pend_alm,false)) and v_creador is not null and v_creador <> v_uid then
      perform sgc.notificar(v_creador, 'firma',
        'Firma de recepción completada',
        format('%s confirmó la entrega que habías dejado pendiente.', trim(p_nombre)),
        '/transporte/conduces');
    end if;
  end if;

  return v_id;
end;
$function$;

commit;
