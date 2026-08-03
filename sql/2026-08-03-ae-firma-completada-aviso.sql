-- ============================================================================
-- AE — Avisar al creador (chofer/emisor) cuando su firma de RECEPTOR pendiente se
-- completa. Cierra el loop de la "firma pendiente enrutada": el que entregó dejando
-- la firma del ingeniero pendiente recibe un aviso cuando el ingeniero la firma.
--
-- Solo agrega el `notificar` al final de firmar_conduce (aditivo). Resto idéntico
-- a la versión vigente. Idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.firmar_conduce(
  p_salida_id uuid, p_rol text, p_nombre text, p_firma_path text,
  p_cedula text default null, p_rol_desc text default null,
  p_metodo text default 'pad', p_usuario_id uuid default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
  v_pend uuid;      -- AE — receptor pendiente ANTES de firmar
  v_creador uuid;   -- AE — quien registró/entregó (para avisarle)
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor') then raise exception 'Rol de firma inválido'; end if;
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

  -- AE — capturar si había una firma pendiente + el creador, ANTES de firmar.
  if v_rol = 'receptor' then
    select firma_pendiente_usuario_id, creado_por into v_pend, v_creador
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
       set firma_pendiente_usuario_id = null, firma_pendiente_nombre = null
     where id = p_salida_id;

    -- AE — si estaba pendiente y la firmó otra persona (se completó), avisar al creador.
    if v_pend is not null and v_creador is not null and v_creador <> v_uid then
      perform sgc.notificar(v_creador, 'firma',
        'Firma de recepción completada',
        format('%s firmó la entrega que habías dejado pendiente.', trim(p_nombre)),
        '/transporte/conduces');
    end if;
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.firmar_conduce(uuid, text, text, text, text, text, text, uuid) to authenticated, service_role;
