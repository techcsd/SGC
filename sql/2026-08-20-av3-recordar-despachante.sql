-- ════════════════════════════════════════════════════════════════════════════
-- AV3 — "Recordarle al despachante" (re-push manual de la firma pendiente)
-- ════════════════════════════════════════════════════════════════════════════
-- El chofer (o Flota) puede re-avisar al despachante que un conduce sigue
-- esperando su firma (complementa el recordatorio automático de 2h de AU1 y el
-- gate de entrega DR456). Aditivo/retrocompatible. Reutiliza el tipo de aviso
-- 'conduce_firma' que la app ya enruta a la bandeja del despachante
-- (/transporte/conduces-por-firmar) — ver notificaciones.service.ts.
--
-- Devuelve el NOMBRE del despachante (para el toast/aviso en la UI), o null si
-- el conduce YA fue firmado (nada que recordar).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function sgc.conduce_recordar_despachante(p_salida_id uuid)
returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  s      record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select s2.id, s2.despachante_usuario_id, s2.despachante_nombre,
         s2.creado_por, s2.conductor_id
    into s
    from sgc.salidas_inventario s2
   where s2.id = p_salida_id;
  if s.id is null then raise exception 'Conduce no encontrado'; end if;

  -- Solo el chofer/creador del conduce (o Flota/admin) puede recordar.
  if not (sgc.is_admin() or sgc.es_flota_elevado()
          or s.creado_por = v_uid
          or exists (select 1 from sgc.conductores c
                       where c.id = s.conductor_id and c.usuario_id = v_uid)) then
    raise exception 'No autorizado';
  end if;

  if s.despachante_usuario_id is null then
    raise exception 'Este conduce no tiene un despachante del sistema.';
  end if;

  -- ¿sigue pendiente de firma? Si ya firmó, no molestamos: devolvemos null.
  if not sgc.conduce_firma_despachante_pendiente(p_salida_id) then
    return null;
  end if;

  perform sgc.notificar(
    s.despachante_usuario_id,
    'conduce_firma',
    'Recordatorio: conduce por firmar',
    'Te recuerdan firmar el conduce ' || ('CND-' || upper(left(p_salida_id::text, 8))) ||
      ' para que el chofer pueda entregarlo.',
    '/transporte/conduces-por-firmar');

  return coalesce(nullif(trim(s.despachante_nombre), ''), 'el despachante');
end;
$$;
grant execute on function sgc.conduce_recordar_despachante(uuid) to authenticated, service_role;
comment on function sgc.conduce_recordar_despachante(uuid) is
  'AV3 — re-avisa al despachante que un conduce espera su firma (tipo conduce_firma → bandeja del despachante). Devuelve el nombre del despachante, o null si ya firmó. Gate: chofer/creador o Flota.';
