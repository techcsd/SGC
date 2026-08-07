-- ============================================================================
-- AI7 + AI8 + AI16 — Plantilla "Uso de vehículo" (4 items) + renombre
--   "Reporte semanal" → "Inspección vehículo" (DB) + orden de SUBmódulos.
--   SGC padre. Aditivo. Históricos intactos (las respuestas snapshotean etiqueta).
-- ----------------------------------------------------------------------------
-- AI7: la plantilla de "Uso de vehículo" (ex pre-uso, PRE-USO-V5) queda con las
--   preguntas del sketch: Documentación, Llantas, Luces (rápidas) + "Fotos y
--   comentarios" (que NO es un item de checklist: son los foto-slots de pre-uso
--   + el comentario libre, ya existentes). Se quita "frenos" (no estaba en V5) y
--   se AGREGA "Documentación"; se retiran Carrocería/Interior/Fugas.
-- AI8: renombre visible en DB de las plantillas y del recordatorio del domingo.
-- AI16: el orden por SUBmódulos YA está soportado por el modelo app (AF38):
--   sgc.app_module_order tiene columna `parent` y set_module_order/get_module_order
--   la persisten y ordenan. No requiere DDL nuevo — ver nota al final.
-- ============================================================================

set search_path = sgc, public;

-- ── AI7 — Plantilla "Uso de vehículo" con 3 checks + fotos/comentarios ──────
update sgc.checklist_plantillas
   set nombre = 'Uso de vehículo'
 where codigo = 'PRE-USO-V5';

delete from sgc.checklist_plantilla_items
 where plantilla_id = (select id from sgc.checklist_plantillas where codigo = 'PRE-USO-V5');

insert into sgc.checklist_plantilla_items
  (plantilla_id, seccion, etiqueta, es_critico, orden, numero, aplica_a, ayuda)
select p.id, x.seccion, x.etiqueta, x.es_critico, x.orden, x.numero, 'Ambos', x.ayuda
from sgc.checklist_plantillas p,
  (values
    ('Documentación', 'Matrícula y seguro presentes en el vehículo', false, 1, '1',
      'Confirma que están la matrícula y el seguro en el vehículo.'),
    ('Llantas', 'Gomas infladas y sin cortes a la vista', true, 2, '2',
      'Solo míralas: que no estén bajas ni con cortes/roturas.'),
    ('Luces', 'Luces encienden: frente, atrás y freno', true, 3, '3',
      'Enciéndelas y confirma que prenden delante, detrás y el freno.')
  ) as x(seccion, etiqueta, es_critico, orden, numero, ayuda)
where p.codigo = 'PRE-USO-V5';
-- "Fotos y comentarios" (4º ítem del sketch) = foto-slots de pre-uso + comentario
-- libre, ya presentes en el flujo de registro; no se modela como item de checklist.

-- ── AI8 — Renombre en DB: plantillas y recordatorio del domingo ─────────────
update sgc.checklist_plantillas set nombre = 'Inspección de vehículo'
 where codigo in ('REPORTE-SEMANAL-V1', 'REPORTE-SEMANAL-V2', 'REPORTE-SEMANAL-V3');
update sgc.checklist_plantillas set nombre = 'Inspección de vehículo — Telehandler'
 where codigo = 'REPORTE-SEMANAL-TELEHANDLER-V1';

create or replace function sgc.recordatorio_reporte_semanal()
 returns integer
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_anio   int := extract(isoyear from (now() at time zone 'America/Santo_Domingo'))::int;
  v_semana int := extract(week   from (now() at time zone 'America/Santo_Domingo'))::int;
  r record;
  v_n int := 0;
begin
  for r in
    select distinct c.chofer_usuario_id as usuario_id, c.placa
    from sgc.v_reporte_semanal_cumplimiento c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    where c.anio = v_anio and c.semana = v_semana
      and not coalesce(c.tiene_reporte, false)
      and c.chofer_usuario_id is not null
      and not coalesce(v.es_prueba, false)
  loop
    perform sgc.notificar(
      r.usuario_id, 'warning',
      'Inspección de vehículo pendiente',
      format('Aún no has enviado la inspección de vehículo de %s. Envíala desde la app.', coalesce(r.placa, 'tu vehículo')),
      '/flota/reporte-semanal'  -- ruta interna sin cambio (AI8: solo cambia el texto)
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
grant execute on function sgc.recordatorio_reporte_semanal() to authenticated, service_role;

-- ── AI16 — Orden de SUBmódulos (nota) ───────────────────────────────────────
-- El modelo de orden de la app (AF38) ya es jerárquico:
--   sgc.app_module_order(clave PK, parent text, orden int) — parent NULL = módulo
--   top-level; parent = clave del módulo padre para un submódulo.
--   sgc.get_module_order() ordena por parent NULLS FIRST, orden.
--   sgc.set_module_order(jsonb[{clave,parent,orden}]) hace upsert respetando parent.
-- Por tanto el drag&drop de SUBmódulos (PROMPT-12) solo debe enviar items con
-- `parent` = clave del módulo contenedor (ej. {clave:'transporte.conduce',
-- parent:'transporte', orden:1}). Requisito: la `clave` de cada submódulo debe ser
-- única globalmente (PK) — usar claves namespaced 'modulo.submodulo'. Sin DDL nuevo.
