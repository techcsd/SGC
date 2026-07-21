-- ============================================================================
-- Actualización 3 · PROMPT-9 · S17+S18 — Reporte semanal: etiquetas cortas +
-- ítem de copias físicas. Actualiza in-place las etiquetas de REPORTE-SEMANAL-V2
-- (la app las lee de BD, sin labels duplicados). Idempotente.
-- ============================================================================
set search_path = sgc, public;

do $$
declare v uuid;
begin
  select id into v from sgc.checklist_plantillas where codigo = 'REPORTE-SEMANAL-V2';
  if v is null then return; end if;

  -- S18 — ítem de documentos ampliado: incluye copias físicas en el vehículo.
  update sgc.checklist_plantilla_items set etiqueta =
    'Matrícula, seguro y permisos: vigentes y con copias físicas dentro del vehículo (si no, multa).'
    where plantilla_id = v and numero = '1';
  -- S17 — resto de etiquetas cortas y escaneables.
  update sgc.checklist_plantilla_items set etiqueta =
    'Luces: delanteras, traseras, freno, direccionales, reversa, parqueo y neblineras.'
    where plantilla_id = v and numero = '2';
  update sgc.checklist_plantilla_items set etiqueta =
    'Neumáticos: presión, desgaste y estado (incluye el de repuesto).'
    where plantilla_id = v and numero = '3';
  update sgc.checklist_plantilla_items set etiqueta =
    'Frenos: de servicio y de emergencia, antes de arrancar.'
    where plantilla_id = v and numero = '4';
  update sgc.checklist_plantilla_items set etiqueta =
    'Motor y fluidos: sin fugas; niveles de aceite y refrigerante.'
    where plantilla_id = v and numero = '5';
  update sgc.checklist_plantilla_items set etiqueta =
    'Visibilidad: limpiaparabrisas y nivel de agua del depósito.'
    where plantilla_id = v and numero = '6';
  update sgc.checklist_plantilla_items set etiqueta =
    'Seguridad: bocina y alarma de retroceso (si aplica).'
    where plantilla_id = v and numero = '7';
  update sgc.checklist_plantilla_items set etiqueta =
    'Herramientas: gato, llave de ruedas, conos/triángulos y requeridas.'
    where plantilla_id = v and numero = '8';
  update sgc.checklist_plantilla_items set etiqueta =
    'Estado general: carrocería, fugas, piezas sueltas o condiciones inseguras.'
    where plantilla_id = v and numero = '9';
end $$;
