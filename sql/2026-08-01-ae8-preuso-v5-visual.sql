-- ============================================================================
-- AE8 — Pre-uso SIMPLIFICADO: chequeo visual rápido (PRE-USO-V5).
-- ----------------------------------------------------------------------------
-- Razonamiento (Xaviel): quien hace un pre-uso NO es el asignado del vehículo.
-- Si le prestan una camioneta para ir a la ferretería no va a llenar un registro
-- enorme; solo mira lo evidente y toma fotos. El chequeo profundo/mecánico es
-- responsabilidad del ASIGNADO en su REPORTE SEMANAL (REPORTE-SEMANAL-V3): si una
-- goma vieja explota, la culpa es del asignado que no lo reportó, no del que hizo
-- el pre-uso.
--
-- Cambio: PRE-USO-V5 (activa; desactiva PRE-USO-V4) — 6 ítems VISUALES/superficiales
-- + las 7 fotos exterior/interior que ya existen (checklist_foto_slots, frecuencia
-- 'preuso'): delantera, lateral_izq, lateral_der, trasera, tablero, interior_del,
-- parte_trasera. No se toca el catálogo de fotos.
--
-- Críticos (bloquean el vehículo si fallan): Gomas, Luces, Fugas visibles — los 3
-- riesgos que SÍ se ven a simple vista. El resto son informativos.
--
-- MAPEO viejo (V4, 9 ítems) → nuevo. Nada crítico se pierde: todo lo que sale del
-- pre-uso ya existe en REPORTE-SEMANAL-V3 (el asignado lo revisa a fondo cada semana):
--   V4-1 Documentación (matrícula/seguro)  → sale del pre-uso → REP-SEM-V3 ítem 1
--   V4-2 Luces                             → SE QUEDA (V5-2)
--   V4-3 Gomas (aire/desgaste/repuesto)    → SE QUEDA visual (V5-1); detalle → REP-SEM-V3 ítem 3
--   V4-4 Frenos (respuesta)                → sale (no es visual) → REP-SEM-V3 ítem 4
--   V4-5 Motor y fluidos                   → SPLIT: fuga VISIBLE → V5-6; niveles → REP-SEM-V3 ítem 5
--   V4-6 Visibilidad (limpiaparabrisas)    → sale → REP-SEM-V3 ítem 6
--   V4-7 Seguridad (bocina/reversa)        → sale → REP-SEM-V3 ítem 7
--   V4-8 Herramientas (gato/llave/conos)   → sale → REP-SEM-V3 ítem 8
--   V4-9 Estado general (daños)            → SE QUEDA como V5-3 Carrocería + V5-4 Interior
--   (nuevo) Combustible visible            → V5-5 (se anota el nivel del tablero)
--
-- ⚠️ La lista final de preguntas la valida Xaviel (ver resumen). Reversible: PRE-USO-V4
-- queda con activo=false y los pre-usos históricos guardan snapshot de sus etiquetas,
-- así que se siguen viendo bien. Aditivo/retrocompatible. Idempotente por `codigo`.
-- ============================================================================

set search_path = sgc, public;

update sgc.checklist_plantillas set activo = false where codigo = 'PRE-USO-V4' and activo;

do $$
declare v_pid uuid;
begin
  insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia)
  values ('PRE-USO-V5', 'Inspección de vehículo (pre-uso)', 'general',
          'Chequeo VISUAL rápido antes de usar el vehículo: 6 puntos de lo que se ve a simple vista (OK/NO/NA + comentario) y fotos de exterior e interior. El chequeo a fondo va en el reporte semanal del asignado.',
          true, 1, 'preuso')
  on conflict (codigo) do update set activo = true, nombre = excluded.nombre,
    categoria = excluded.categoria, descripcion = excluded.descripcion,
    orden = excluded.orden, frecuencia = excluded.frecuencia;
  select id into v_pid from sgc.checklist_plantillas where codigo = 'PRE-USO-V5';
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;
  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, ayuda, es_critico, aplica_a, orden) values
    (v_pid,'Gomas','1','Gomas infladas y sin cortes a la vista',
       'Solo míralas: que no estén bajas ni con cortes/roturas. El desgaste y el repuesto los revisa el asignado en su reporte semanal.', true,'Ambos',1),
    (v_pid,'Luces','2','Luces encienden: frente, atrás y freno',
       'Enciéndelas y confirma que prenden delante, detrás y el freno. Nada más.', true,'Ambos',2),
    (v_pid,'Carrocería','3','Sin golpes ni daños nuevos por fuera',
       'Dale una vuelta rápida: ¿algún golpe, rayón o pieza suelta nueva? Tómale foto.', false,'Ambos',3),
    (v_pid,'Interior','4','Interior limpio y sin objetos sueltos',
       'Que esté limpio y sin cosas rodando. Tómale foto al interior.', false,'Ambos',4),
    (v_pid,'Combustible','5','Nivel de combustible (anótalo en el comentario)',
       'Mira la aguja del tablero y escribe cuánto tiene (ej: 1/2, 3/4, lleno). La foto del tablero lo respalda.', false,'Ambos',5),
    (v_pid,'Fugas','6','Sin manchas de aceite o agua debajo',
       'Mira el piso donde estaba parqueado: ¿hay manchas frescas de aceite, agua o combustible?', true,'Ambos',6);
end $$;

-- Sanidad: las 7 fotos de pre-uso siguen intactas (no las tocamos aquí).
-- select frecuencia, seccion, slot, etiqueta from sgc.checklist_foto_slots where frecuencia = 'preuso' order by orden;
