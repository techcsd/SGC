-- ============================================================================
-- Actualización 5 — U2 + U7: seeds con textos cortos y llanos ("cavernícola").
-- ----------------------------------------------------------------------------
-- Las etiquetas actuales (PRE-USO-V3 y REPORTE-SEMANAL-V2) son largas y con
-- tecnicismos ("freno de servicio", "neumáticos", "fluidos"). El jefe las quiere
-- cortas, en español llano y de lectura instantánea, con el detalle largo movido
-- a un campo de AYUDA secundario.
--
-- Cambios:
--   1) Columna aditiva `checklist_plantilla_items.ayuda text` (detalle largo).
--      Web y app siguen leyendo la plantilla activa por `etiqueta` sin cambios;
--      mostrar `ayuda` es opcional (PROMPT-14).
--   2) PRE-USO-V4  (activa; desactiva PRE-USO-V3)  — 9 ítems, mismas secciones,
--      criticidad y orden; las 5 de seguridad siguen bloqueando (críticas).
--   3) REPORTE-SEMANAL-V3 (activa; desactiva V2) — mismas 9 etiquetas cortas,
--      NINGUNA crítica (un "NO" = hallazgo, no bloqueo).
--
-- Reversible: las versiones anteriores quedan (activo=false) para históricos; sus
-- respuestas guardan snapshot de la etiqueta, así que se siguen viendo bien.
-- Aditivo/retrocompatible. Idempotente por `codigo`.
-- ============================================================================

set search_path = sgc, public;

-- 1) Columna de ayuda (detalle largo, secundario a la etiqueta corta).
alter table sgc.checklist_plantilla_items
  add column if not exists ayuda text;

-- 2) PRE-USO-V4 — inspección diaria (5 de seguridad = críticas).
update sgc.checklist_plantillas set activo = false where codigo = 'PRE-USO-V3' and activo;

do $$
declare v_pid uuid;
begin
  insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia)
  values ('PRE-USO-V4', 'Inspección de vehículo (pre-uso)', 'general',
          'Inspección diaria en lenguaje llano (9 puntos OK/NO/NA + comentario). Las 5 de seguridad vial bloquean el vehículo si fallan.',
          true, 1, 'preuso')
  on conflict (codigo) do update set activo = true, nombre = excluded.nombre,
    categoria = excluded.categoria, descripcion = excluded.descripcion,
    orden = excluded.orden, frecuencia = excluded.frecuencia;
  select id into v_pid from sgc.checklist_plantillas where codigo = 'PRE-USO-V4';
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;
  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, ayuda, es_critico, aplica_a, orden) values
    (v_pid,'Documentación','1','Matrícula y seguro al día · copias dentro del carro',
       'Sin las copias físicas dentro del vehículo te pueden poner multa.', true,'Ambos',1),
    (v_pid,'Luces','2','Luces: delanteras, traseras, direccionales, freno',
       'Prueba también reversa, parqueo y neblineras. Que todas enciendan.', true,'Ambos',2),
    (v_pid,'Gomas','3','Gomas en buen estado · repuesto listo',
       'Revisa aire, desgaste y que no tengan cortes. La goma de repuesto también.', true,'Ambos',3),
    (v_pid,'Frenos','4','Frenos: que respondan bien',
       'Prueba el freno de pie y el de mano antes de arrancar.', true,'Ambos',4),
    (v_pid,'Motor y fluidos','5','Sin fugas · aceite y agua en nivel',
       'Que no gotee aceite, combustible ni agua. Revisa los niveles.', true,'Ambos',5),
    (v_pid,'Visibilidad','6','Limpiaparabrisas con agua',
       'Que el limpiaparabrisas funcione y tenga agua en el depósito.', false,'Ambos',6),
    (v_pid,'Seguridad','7','Bocina y alarma de reversa',
       'Prueba la bocina y, si tiene, la alarma de retroceso.', false,'Ambos',7),
    (v_pid,'Herramientas','8','Gato, llave de ruedas y conos',
       'Que estén y sirvan: gato, llave de ruedas, conos o triángulos.', false,'Ambos',8),
    (v_pid,'Estado general','9','Carro sin daños ni piezas sueltas',
       'Míralo por fuera: golpes, fugas o algo suelto antes de salir.', false,'Ambos',9);
end $$;

-- 3) REPORTE-SEMANAL-V3 — mismas etiquetas cortas, NINGUNA crítica.
update sgc.checklist_plantillas set activo = false where codigo = 'REPORTE-SEMANAL-V2' and activo;

do $$
declare v_pid uuid;
begin
  insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia)
  values ('REPORTE-SEMANAL-V3', 'Reporte semanal de vehículo', 'general',
          'Reporte semanal en lenguaje llano: 9 puntos (OK/NO/NA) y un comentario abierto opcional.',
          true, 100, 'semanal')
  on conflict (codigo) do update set activo = true, nombre = excluded.nombre,
    categoria = excluded.categoria, descripcion = excluded.descripcion,
    orden = excluded.orden, frecuencia = excluded.frecuencia;
  select id into v_pid from sgc.checklist_plantillas where codigo = 'REPORTE-SEMANAL-V3';
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;
  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, ayuda, es_critico, aplica_a, orden) values
    (v_pid,'Documentación','1','Matrícula y seguro al día · copias dentro del carro',
       'Sin las copias físicas dentro del vehículo te pueden poner multa.', false,'Ambos',1),
    (v_pid,'Luces','2','Luces: delanteras, traseras, direccionales, freno',
       'Prueba también reversa, parqueo y neblineras. Que todas enciendan.', false,'Ambos',2),
    (v_pid,'Gomas','3','Gomas en buen estado · repuesto listo',
       'Revisa aire, desgaste y que no tengan cortes. La goma de repuesto también.', false,'Ambos',3),
    (v_pid,'Frenos','4','Frenos: que respondan bien',
       'Prueba el freno de pie y el de mano antes de arrancar.', false,'Ambos',4),
    (v_pid,'Motor y fluidos','5','Sin fugas · aceite y agua en nivel',
       'Que no gotee aceite, combustible ni agua. Revisa los niveles.', false,'Ambos',5),
    (v_pid,'Visibilidad','6','Limpiaparabrisas con agua',
       'Que el limpiaparabrisas funcione y tenga agua en el depósito.', false,'Ambos',6),
    (v_pid,'Seguridad','7','Bocina y alarma de reversa',
       'Prueba la bocina y, si tiene, la alarma de retroceso.', false,'Ambos',7),
    (v_pid,'Herramientas','8','Gato, llave de ruedas y conos',
       'Que estén y sirvan: gato, llave de ruedas, conos o triángulos.', false,'Ambos',8),
    (v_pid,'Estado general','9','Carro sin daños ni piezas sueltas',
       'Míralo por fuera: golpes, fugas o algo suelto antes de salir.', false,'Ambos',9);
end $$;
