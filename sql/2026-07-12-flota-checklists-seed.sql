-- ============================================================================
-- A6 — Seed de plantillas de checklist de Flota (formularios reales de la reunión)
-- Idempotente: no duplica si ya existen (por codigo / por items).
-- ============================================================================
set search_path = sgc, public;

do $$
declare v_pl uuid;
begin
  -- ── 1) Pre-Uso — Vehículo Liviano (aptitud) ──────────────────────────────
  insert into sgc.checklist_plantillas(codigo, nombre, categoria, descripcion, orden)
  values ('PRE-USO-LIVIANO', 'Pre-Uso — Vehículo Liviano', 'liviano',
          'Verificación de aptitud previa al uso de vehículos livianos.', 1)
  on conflict (codigo) do nothing;
  select id into v_pl from sgc.checklist_plantillas where codigo = 'PRE-USO-LIVIANO';
  if not exists (select 1 from sgc.checklist_plantilla_items where plantilla_id = v_pl) then
    insert into sgc.checklist_plantilla_items(plantilla_id, seccion, etiqueta, es_critico, orden) values
      (v_pl,'aptitud','Licencia de conducir vigente', true, 1),
      (v_pl,'aptitud','Conductor libre de alcohol y fatiga', true, 2),
      (v_pl,'aptitud','Vehículo con mantenimiento al día', false, 3),
      (v_pl,'aptitud','Compromiso de no usar dispositivos al conducir', false, 4),
      (v_pl,'aptitud','Conoce la ruta / destino', false, 5),
      (v_pl,'aptitud','Radio / medio de comunicación operativo', false, 6),
      (v_pl,'aptitud','Condiciones climáticas adecuadas', false, 7),
      (v_pl,'aptitud','Medios de emergencia disponibles', false, 8);
  end if;

  -- ── 2) Inspección de Seguridad "Autorizado y Apto para la Tarea" (19) ────
  insert into sgc.checklist_plantillas(codigo, nombre, categoria, descripcion, orden)
  values ('INSP-SEGURIDAD', 'Inspección de Seguridad — Autorizado y Apto para la Tarea', 'general',
          'Checklist de 19 puntos de seguridad del vehículo antes de la tarea.', 2)
  on conflict (codigo) do nothing;
  select id into v_pl from sgc.checklist_plantillas where codigo = 'INSP-SEGURIDAD';
  if not exists (select 1 from sgc.checklist_plantilla_items where plantilla_id = v_pl) then
    insert into sgc.checklist_plantilla_items(plantilla_id, seccion, etiqueta, es_critico, orden) values
      (v_pl,'seguridad','Luces', true, 1),
      (v_pl,'seguridad','Calzo', false, 2),
      (v_pl,'seguridad','Conos', false, 3),
      (v_pl,'seguridad','Neumáticos', true, 4),
      (v_pl,'seguridad','Reemplazo de neumáticos (repuesto)', false, 5),
      (v_pl,'seguridad','Tuercas', true, 6),
      (v_pl,'seguridad','Alarma de retroceso', true, 7),
      (v_pl,'seguridad','Bocina', false, 8),
      (v_pl,'seguridad','Vidrios', false, 9),
      (v_pl,'seguridad','Espejos', false, 10),
      (v_pl,'seguridad','Motor', false, 11),
      (v_pl,'seguridad','Cinturón de seguridad', true, 12),
      (v_pl,'seguridad','Extintor', true, 13),
      (v_pl,'seguridad','Limpiaparabrisas', false, 14),
      (v_pl,'seguridad','Cabina', false, 15),
      (v_pl,'seguridad','Frenos', true, 16),
      (v_pl,'seguridad','Botiquín', false, 17),
      (v_pl,'seguridad','Matrícula / seguro', false, 18),
      (v_pl,'seguridad','Panel de instrumentos', false, 19);
  end if;

  -- ── 3) Pre-Uso — Camión (aptitud + puntos de carga pesada) ───────────────
  insert into sgc.checklist_plantillas(codigo, nombre, categoria, descripcion, orden)
  values ('PRE-USO-CAMION', 'Pre-Uso — Camión', 'camion',
          'Verificación de aptitud y seguridad previa al uso de camiones.', 3)
  on conflict (codigo) do nothing;
  select id into v_pl from sgc.checklist_plantillas where codigo = 'PRE-USO-CAMION';
  if not exists (select 1 from sgc.checklist_plantilla_items where plantilla_id = v_pl) then
    insert into sgc.checklist_plantilla_items(plantilla_id, seccion, etiqueta, es_critico, orden) values
      (v_pl,'aptitud','Licencia de conducir vigente (categoría correcta)', true, 1),
      (v_pl,'aptitud','Conductor libre de alcohol y fatiga', true, 2),
      (v_pl,'aptitud','Vehículo con mantenimiento al día', false, 3),
      (v_pl,'aptitud','Radio / medio de comunicación operativo', false, 4),
      (v_pl,'seguridad','Frenos', true, 5),
      (v_pl,'seguridad','Luces y luces de gálibo', true, 6),
      (v_pl,'seguridad','Neumáticos y tuercas', true, 7),
      (v_pl,'seguridad','Alarma de retroceso', true, 8),
      (v_pl,'seguridad','Carga asegurada / amarres', true, 9),
      (v_pl,'seguridad','Extintor', true, 10),
      (v_pl,'seguridad','Espejos', false, 11),
      (v_pl,'seguridad','Botiquín', false, 12);
  end if;
end $$;
