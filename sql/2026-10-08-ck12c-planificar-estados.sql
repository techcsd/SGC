-- 2026-10-08-ck12c-planificar-estados.sql
-- CK12 — alinear los escritores de estado de solicitudes_movimiento a los estados nuevos
-- (ck12 cambió el check: planificada→asignada, en_curso→en_proceso). Sin esto,
-- planificar_solicitud_con_ruta y el trigger tg_sol_mov_ruta_sync escribirían un estado
-- que el nuevo check RECHAZA. Regla 19: cuerpos copiados de la def viva, solo cambian los
-- literales de estado.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck12c-planificar-estados.sql --env dev

begin;

create or replace function sgc.planificar_solicitud_con_ruta(p_id uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date DEFAULT NULL::date, p_notas text DEFAULT NULL::text)
 returns uuid
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_s sgc.solicitudes_movimiento%rowtype;
  v_ruta uuid; v_cond_usuario uuid; v_origen text; v_destino text;
begin
  if not sgc.es_referente_movimiento() then raise exception 'No autorizado.' using errcode='42501'; end if;
  select * into v_s from sgc.solicitudes_movimiento where id = p_id;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado not in ('pendiente','asignada') then
    raise exception 'La solicitud no está en un estado planificable (%).', v_s.estado;
  end if;
  if p_conductor_id is null then raise exception 'Elige un chofer.'; end if;

  v_origen  := coalesce(nullif(v_s.origen_texto,''),  (select nombre from sgc.bodegas where id=v_s.origen_bodega_id),   (select nombre from sgc.proyectos where id=v_s.origen_proyecto_id),  'Origen');
  v_destino := coalesce(nullif(v_s.destino_texto,''), (select nombre from sgc.bodegas where id=v_s.destino_bodega_id),  (select nombre from sgc.proyectos where id=v_s.destino_proyecto_id), 'Destino');

  insert into sgc.rutas (tipo, vehiculo_id, conductor_id, origen, destino, destino_proyecto_id, fecha, estado, notas, creado_por, es_prueba)
  values ('material', p_vehiculo_id, p_conductor_id, v_origen, v_destino,
          coalesce(v_s.destino_proyecto_id, v_s.proyecto_id), coalesce(p_fecha, current_date),
          'planificada', coalesce(nullif(trim(p_notas),''), 'Solicitud de movimiento: '||left(v_s.que_se_mueve,80)),
          auth.uid(), coalesce(v_s.es_prueba,false))
  returning id into v_ruta;

  update sgc.solicitudes_movimiento
     set estado='asignada', ruta_id=v_ruta, conductor_id=p_conductor_id
   where id = p_id;

  select usuario_id into v_cond_usuario from sgc.conductores where id = p_conductor_id;
  if v_cond_usuario is not null then
    perform sgc.notificar(v_cond_usuario, 'solicitud_movimiento', 'Ruta asignada (apoyo de transporte)',
      'Se te asignó mover: '||left(v_s.que_se_mueve,70)||' ('||v_origen||' → '||v_destino||').', '/flota/rutas');
  end if;
  perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento', 'Tu apoyo fue asignado',
    'Se creó una ruta para "'||left(v_s.que_se_mueve,60)||'".', '/transporte/apoyo');
  return v_ruta;
end $function$;

create or replace function sgc.tg_sol_mov_ruta_sync()
 returns trigger
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_s sgc.solicitudes_movimiento%rowtype;
begin
  if NEW.estado is distinct from OLD.estado and NEW.estado in ('completada','entregada','recibida') then
    for v_s in select * from sgc.solicitudes_movimiento
               where ruta_id = NEW.id and estado in ('asignada','en_proceso') loop
      update sgc.solicitudes_movimiento
         set estado='por_confirmar'
       where id = v_s.id;
      perform sgc.notificar(v_s.solicitante_id, 'solicitud_movimiento', 'Tu apoyo de transporte: por confirmar',
        'La ruta de "'||left(v_s.que_se_mueve,60)||'" terminó. Confírmalo cuando lo verifiques.', '/transporte/apoyo');
    end loop;
  elsif NEW.estado is distinct from OLD.estado and NEW.estado in ('en_camino','en_curso') then
    update sgc.solicitudes_movimiento set estado='en_proceso'
     where ruta_id = NEW.id and estado = 'asignada';
  end if;
  return NEW;
end $function$;

commit;
