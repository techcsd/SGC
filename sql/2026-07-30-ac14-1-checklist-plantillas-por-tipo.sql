-- ============================================================================
-- AC14.1 — Plantillas de checklist/reporte por TIPO de vehículo (30/07/2026)
-- ----------------------------------------------------------------------------
-- Hoy las plantillas se eligen por clase (Liviano/Pesado, via items.aplica_a) +
-- frecuencia + uso. Aditivo: se agrega `tipo_vehiculo` a la plantilla. Una
-- plantilla con tipo_vehiculo = <tipo> se prefiere para ese tipo; NULL = genérica
-- (comportamiento actual, camiones). Se crea la plantilla del telehandler con sus
-- 15 puntos (reporte semanal). OK/falla + comentario/foto en falla, como ya
-- funciona el motor. Administrable: editando la plantilla y sus items en el SGC.
-- ============================================================================

set search_path = sgc, public;

-- 1) Columna aditiva
alter table sgc.checklist_plantillas
  add column if not exists tipo_vehiculo text;
comment on column sgc.checklist_plantillas.tipo_vehiculo is
  'AC14.1 — cuando no es NULL, esta plantilla es específica de ese sgc.vehiculos.tipo y se prefiere sobre la genérica.';

-- 2) Selección: preferir la plantilla específica por tipo, luego la genérica.
create or replace function sgc.checklist_plantilla_vigente(p_vehiculo_id uuid, p_frecuencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uso    text;
  v_tipo   text;
  v_clase  text;
  v_pid    uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;

  select coalesce(uso,'obra'), tipo into v_uso, v_tipo
    from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado'; end if;

  v_clase := case when v_tipo in ('motocicleta','automovil','suv','pickup','otro') then 'Liviano' else 'Pesado' end;

  if p_frecuencia = 'semanal' then
    -- AC14.1 — plantilla específica por tipo primero; si no hay, la genérica.
    select id into v_pid from sgc.checklist_plantillas
      where activo and frecuencia = 'semanal'
        and (tipo_vehiculo = v_tipo or tipo_vehiculo is null)
      order by (tipo_vehiculo = v_tipo) desc nulls last, orden
      limit 1;
  else
    select id into v_pid from sgc.checklist_plantillas
      where activo and frecuencia = 'preuso'
        and (tipo_vehiculo = v_tipo or tipo_vehiculo is null)
        and uso_aplica in (v_uso, 'ambos')
      order by (tipo_vehiculo = v_tipo) desc nulls last, (uso_aplica = v_uso) desc, orden
      limit 1;
  end if;

  if v_pid is null then return null; end if;

  select jsonb_build_object(
    'plantilla', (select to_jsonb(p) from sgc.checklist_plantillas p where p.id = v_pid),
    'items', (
      select coalesce(jsonb_agg(to_jsonb(i) order by i.orden), '[]'::jsonb)
      from sgc.checklist_plantilla_items i
      where i.plantilla_id = v_pid
        and (i.aplica_a = 'Ambos' or i.aplica_a = v_clase)
    ),
    'foto_slots', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slot', s.slot, 'seccion', s.seccion, 'etiqueta', s.etiqueta, 'orden', s.orden) order by s.orden), '[]'::jsonb)
      from sgc.checklist_foto_slots s
      where s.frecuencia = coalesce(nullif(p_frecuencia,''),'preuso') and s.activo
    ),
    'uso', v_uso,
    'clase', v_clase
  ) into v_result;

  return v_result;
end;
$function$;

-- 3) Plantilla del telehandler: reporte semanal con los 15 puntos de obra.
insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia, uso_aplica, tipo_vehiculo)
values ('REPORTE-SEMANAL-TELEHANDLER-V1', 'Reporte semanal — Telehandler', 'equipo',
        'Inspección semanal del telehandler (15 puntos de obra). Responder OK/Falla; en falla, comentario y foto.',
        true, 10, 'semanal', 'ambos', 'telehandler')
on conflict (codigo) do update
  set nombre = excluded.nombre, categoria = excluded.categoria, descripcion = excluded.descripcion,
      activo = true, frecuencia = 'semanal', uso_aplica = 'ambos', tipo_vehiculo = 'telehandler';

-- Reemplazar sus items (idempotente).
delete from sgc.checklist_plantilla_items
 where plantilla_id = (select id from sgc.checklist_plantillas where codigo = 'REPORTE-SEMANAL-TELEHANDLER-V1');

insert into sgc.checklist_plantilla_items (plantilla_id, seccion, etiqueta, es_critico, orden, numero, aplica_a)
select p.id, 'Inspección telehandler', x.etiqueta, false, x.orden, x.numero, 'Ambos'
from sgc.checklist_plantillas p,
  (values
    (1,  'T1',  'El boom sube y baja correctamente'),
    (2,  'T2',  'El boom entra y sale correctamente'),
    (3,  'T3',  'La uña abre y cierra correctamente'),
    (4,  'T4',  'Las patas suben y bajan correctamente'),
    (5,  'T5',  'Sistema de nivelación funcional'),
    (6,  'T6',  'Estado de las gomas'),
    (7,  'T7',  'Las luces encienden'),
    (8,  'T8',  'Alarma de reversa funciona'),
    (9,  'T9',  'La bocina funciona'),
    (10, 'T10', 'Tanque de combustible (nivel/estado)'),
    (11, 'T11', 'Nivel de aceite hidráulico'),
    (12, 'T12', 'Retrovisores en buen estado'),
    (13, 'T13', 'Niveles de fluido correctos'),
    (14, 'T14', 'Nivel de grasa'),
    (15, 'T15', 'Sistema de dirección')
  ) as x(orden, numero, etiqueta)
where p.codigo = 'REPORTE-SEMANAL-TELEHANDLER-V1';
