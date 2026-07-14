-- ============================================================================
-- Reporte semanal de vehículo — Plantilla OFICIAL (v2)
-- ----------------------------------------------------------------------------
-- Reemplaza las preguntas propuestas por PROMPT-1 (REPORTE-SEMANAL-V1) por las
-- 9 preguntas oficiales del papel del jefe (CONTEXTO-ACTUALIZACION-1 §B):
--   9 ítems OK/NO/NA, NINGUNO crítico (es reporte semanal, no pre-uso).
--   El ítem 10 "Algún comentario" NO es ítem OK/NO/NA: se captura como el campo
--   de observaciones de la cabecera del checklist (opcional del wizard).
--
-- Versionado igual que el catálogo de Flota v2 (2026-07-13-flota-checklists-seed-v2):
--   - Se DESACTIVA REPORTE-SEMANAL-V1 (activo=false) SIN tocar su frecuencia,
--     para que los reportes históricos sigan contando en el cumplimiento y su
--     detalle se siga visualizando (las respuestas guardan snapshot de etiqueta).
--   - Se inserta REPORTE-SEMANAL-V2 activa (idempotente por codigo).
--
-- Kilometraje: se mantiene como dato de la cabecera del wizard (alimenta la
-- coherencia de km y el mantenimiento por km). NO es una "pregunta".
-- Nivel de combustible: es un campo genérico OPCIONAL de la cabecera del
-- checklist (checklists_vehiculo.nivel_combustible, sin validación), compartido
-- por todos los tipos — NO fue sembrado como ítem del semanal, así que no hay
-- nada que eliminar; queda opcional tal como está.
--
-- Un "NO" en cualquier ítem (ninguno crítico) => veredicto 'con_hallazgos' en
-- registrar_checklist_vehiculo(), que YA inserta el aviso tipo 'hallazgos' y
-- notifica a Flota. Mismo mecanismo de hallazgos existente, sin cambios.
--
-- Aditivo/retrocompatible: no borra plantillas ni reportes. Idempotente.
-- ============================================================================

set search_path = sgc, public;

-- 1) Desactivar la plantilla semanal v1 (se conserva para históricos).
--    Se filtra por frecuencia='semanal' para no tocar las de pre-uso/inspección.
update sgc.checklist_plantillas
   set activo = false
 where codigo = 'REPORTE-SEMANAL-V1'
   and activo;

-- 2) Sembrar / actualizar la plantilla semanal v2 (idempotente por codigo) con
--    las 9 preguntas oficiales. Cada pregunta pertenece a su propia sección.
do $$
declare v_pid uuid;
begin
  insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia)
  values ('REPORTE-SEMANAL-V2', 'Reporte semanal de vehículo', 'general',
          'Reporte semanal oficial del estado del vehículo: 9 puntos de inspección (OK/NO/NA) y un comentario abierto opcional.',
          true, 100, 'semanal')
  on conflict (codigo) do update set
    activo      = true,
    nombre      = excluded.nombre,
    categoria   = excluded.categoria,
    descripcion = excluded.descripcion,
    orden       = excluded.orden,
    frecuencia  = excluded.frecuencia;

  select id into v_pid from sgc.checklist_plantillas where codigo = 'REPORTE-SEMANAL-V2';

  -- Re-seed limpio de los ítems (idempotente).
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;

  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, es_critico, aplica_a, orden) values
    (v_pid, 'Documentación y autorización', '1',
     'Verificar que la matrícula, seguro y permisos estén vigentes.', false, 'Ambos', 1),
    (v_pid, 'Luces y señalización', '2',
     'Comprobar funcionamiento de luces delanteras, traseras, freno, direccionales, reversa, parqueo y neblineras.', false, 'Ambos', 2),
    (v_pid, 'Neumáticos y ruedas', '3',
     'Revisar presión, desgaste, cortes o fisuras en los neumáticos. Confirmar que el neumático de repuesto esté en buenas condiciones.', false, 'Ambos', 3),
    (v_pid, 'Sistema de frenos', '4',
     'Verificar el funcionamiento del freno de servicio y del freno de emergencia antes de iniciar la marcha.', false, 'Ambos', 4),
    (v_pid, 'Motor y fluidos', '5',
     'Inspeccionar que no existan fugas de aceite, combustible o refrigerante. Revisar niveles de aceite, refrigerante y otros fluidos visibles.', false, 'Ambos', 5),
    (v_pid, 'Visibilidad del conductor', '6',
     'Verificar el funcionamiento de limpiaparabrisas y el nivel del agua del depósito.', false, 'Ambos', 6),
    (v_pid, 'Dispositivos de seguridad', '7',
     'Probar la bocina y, cuando aplique, la alarma de retroceso.', false, 'Ambos', 7),
    (v_pid, 'Herramientas y equipos de emergencia', '8',
     'Confirmar la presencia y buen estado de gato, llave de ruedas, conos o triángulos y demás herramientas requeridas.', false, 'Ambos', 8),
    (v_pid, 'Estado general del vehículo', '9',
     'Revisar visualmente la carrocería, posibles daños, fugas, piezas sueltas u otras condiciones inseguras antes de salir.', false, 'Ambos', 9);
end $$;
