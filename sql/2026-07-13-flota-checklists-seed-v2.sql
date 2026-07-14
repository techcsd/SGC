-- ============================================================================
-- Flota v2 — Seed del catálogo de checklist de pre-uso (alineado al Excel del
-- jefe: hoja Catalogo_Checklist de "Plataforma Preuso Vehiculos.xlsx").
--   33 ítems: LSC - Autorizado y Apto (10) + Seguridad (19) + Herramienta Pesado (4).
--   Herramienta Pesado aplica solo a vehículos Pesados (aplica_a).
--   Ítems críticos: 1.1, 1.2, 1.3, Seg 1, 4, 6, 11, 12, 13, 16, 18, P1, P2.
-- Versionado: se DESACTIVAN las plantillas viejas (no se borran, para no romper
-- históricos) y se inserta una plantilla unificada PRE-USO-V2. Idempotente.
-- ============================================================================
set search_path = sgc, public;

-- Columnas nuevas del catálogo (numeración + a qué tipo de vehículo aplica).
alter table sgc.checklist_plantilla_items
  add column if not exists numero   text,
  add column if not exists aplica_a text not null default 'Ambos';
do $$ begin
  alter table sgc.checklist_plantilla_items
    add constraint checklist_item_aplica_chk check (aplica_a in ('Liviano','Pesado','Ambos'));
exception when duplicate_object then null; end $$;

-- Desactivar plantillas v1 (se conservan para históricos): cualquiera que no sea v2.
update sgc.checklist_plantillas set activo = false
 where codigo <> 'PRE-USO-V2' and activo;

do $$
declare v_pl uuid;
begin
  insert into sgc.checklist_plantillas(codigo, nombre, categoria, descripcion, orden, activo)
  values ('PRE-USO-V2', 'Pre-Uso de Vehículos (v2)', 'general',
          'Checklist de pre-uso alineado al formulario físico: LSC (autorizado y apto), 19 puntos de seguridad y herramienta de equipo pesado.', 1, true)
  on conflict (codigo) do update set activo = true, nombre = excluded.nombre,
    descripcion = excluded.descripcion, categoria = excluded.categoria, orden = excluded.orden;
  select id into v_pl from sgc.checklist_plantillas where codigo = 'PRE-USO-V2';

  -- Re-seed limpio de los ítems (idempotente).
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pl;

  insert into sgc.checklist_plantilla_items(plantilla_id, seccion, numero, etiqueta, es_critico, aplica_a, orden) values
    -- ── LSC - Autorizado y Apto ──────────────────────────────────────────
    (v_pl,'LSC - Autorizado y Apto','1.1','¿Se encuentran mi licencia y autorización de manejo vigentes (al día)?', true,'Ambos',1),
    (v_pl,'LSC - Autorizado y Apto','1.2','¿Estoy libre de influencia del alcohol/drogas/medicación que podría afectar mi juicio?', true,'Ambos',2),
    (v_pl,'LSC - Autorizado y Apto','1.3','¿Estoy libre de la influencia o signos de fatiga?', true,'Ambos',3),
    (v_pl,'LSC - Autorizado y Apto','2.1','¿Puede confirmar que todos los mantenimientos preventivos/servicios de este vehículo están al día?', false,'Ambos',4),
    (v_pl,'LSC - Autorizado y Apto','3.1','Me comprometo a no utilizar dispositivos electrónicos, únicamente un sistema de radio fijo portátil, mientras opero este equipo.', false,'Ambos',5),
    (v_pl,'LSC - Autorizado y Apto','3.2','Soy consciente de la ruta que voy a tomar y estoy comprometido a obedecer todas las regulaciones de tránsito (límites de velocidad, distancias de seguimiento, señalizaciones, entre otras).', false,'Ambos',6),
    (v_pl,'LSC - Autorizado y Apto','4.1','He considerado las condiciones climáticas/del camino y ajustaré mi forma de conducir de acuerdo con las condiciones.', false,'Ambos',7),
    (v_pl,'LSC - Autorizado y Apto','4.2','¿Se encuentra la radio en buen estado? ¿Es audible, el indicador de canal está visible, seleccionó el canal correcto?', false,'Ambos',8),
    (v_pl,'LSC - Autorizado y Apto','4.3','¿Conoce usted el protocolo de comunicación efectiva?', false,'Ambos',9),
    (v_pl,'LSC - Autorizado y Apto','4.4','¿Usted posee los medios para pedir auxilio en caso de emergencia?', false,'Ambos',10),
    -- ── Seguridad (19) ────────────────────────────────────────────────────
    (v_pl,'Seguridad','1','Luces: delanteras, traseras, direccionales, de parqueo, reversa, corta neblinas.', true,'Ambos',11),
    (v_pl,'Seguridad','2','Calzo: en buen estado, adecuado para el tamaño de la goma y certificado.', false,'Ambos',12),
    (v_pl,'Seguridad','3','Conos o triángulos: al menos uno de los dos requeridos está en buen estado.', false,'Ambos',13),
    (v_pl,'Seguridad','4','Neumáticos: en buen estado, sin fisuras ni daños, presión adecuada, repuesto en buen estado.', true,'Ambos',14),
    (v_pl,'Seguridad','5','Reemplazo de neumáticos: posee gato, llave de ruedas y otras herramientas en buen estado.', false,'Ambos',15),
    (v_pl,'Seguridad','6','Tuercas: todas colocadas y con sus indicadores de movimiento.', true,'Ambos',16),
    (v_pl,'Seguridad','7','Alarma de retroceso: funciona y es audible a pesar del ruido circulante.', false,'Ambos',17),
    (v_pl,'Seguridad','8','Bocina: funciona y es audible a pesar del ruido circulante.', false,'Ambos',18),
    (v_pl,'Seguridad','9','Vidrio: delantero, laterales y trasero; permite visibilidad, sin fisuras ni roturas.', false,'Ambos',19),
    (v_pl,'Seguridad','10','Espejos: retrovisores ajustados, limpios, sin obstrucciones, fisuras ni roturas.', false,'Ambos',20),
    (v_pl,'Seguridad','11','Motor: sin fugas de aceite/combustible/líquidos; niveles y correas en buen estado.', true,'Ambos',21),
    (v_pl,'Seguridad','12','Cinturón de seguridad: correa, hebillas, puntos de fijación, sistema retráctil operativo.', true,'Ambos',22),
    (v_pl,'Seguridad','13','Extintor: accesible y fijo, manómetro en verde, precinto, pasador, tarjeta de inspección mensual vigente.', true,'Ambos',23),
    (v_pl,'Seguridad','14','Limpiaparabrisas: escobillas en buen estado, operan bien, reservorio con agua.', false,'Ambos',24),
    (v_pl,'Seguridad','15','Cabina: limpia, ordenada y sin objetos sueltos.', false,'Ambos',25),
    (v_pl,'Seguridad','16','Frenos: de servicio y de emergencia funcionando correctamente.', true,'Ambos',26),
    (v_pl,'Seguridad','17','Botiquín: elementos completos, no vencidos, en buen estado y con capacidad adecuada.', false,'Ambos',27),
    (v_pl,'Seguridad','18','Matrícula y seguro: vigente y correspondiente al vehículo inspeccionado.', true,'Ambos',28),
    (v_pl,'Seguridad','19','Indicadores del panel: velocímetro, combustible, temperatura, luces de advertencia, etc.', false,'Ambos',29),
    -- ── Herramienta Pesado (solo Pesado) ───────────────────────────────────
    (v_pl,'Herramienta Pesado','P1','Gato hidráulico de gran capacidad: presente y en buen estado (especificación a confirmar con mantenimiento).', true,'Pesado',30),
    (v_pl,'Herramienta Pesado','P2','Linga / eslinga de remolque: presente, en buen estado y con capacidad adecuada (a confirmar).', true,'Pesado',31),
    (v_pl,'Herramienta Pesado','P3','Cadenas: presentes y en buen estado (a confirmar).', false,'Pesado',32),
    (v_pl,'Herramienta Pesado','P4','Cuñas grandes: presentes y en buen estado (a confirmar).', false,'Pesado',33);
end $$;
