-- ============================================================================
-- Z5-FIX — Cierra la fuga de datos de prueba en proyectos/bodegas (PROMPT-8)
-- ============================================================================
-- Bug detectado en PROMPT-8: Z5 extendió el MAPA de _cascada_prueba y las
-- whitelists de marcar/eliminar para proyectos/bodegas, PERO nunca:
--   (a) enganchó el trigger trg_cascada_prueba a proyectos/bodegas → marcar un
--       proyecto/almacén como prueba NO marcaba sus derivados existentes
--       (bitácoras, cronograma, salidas, entradas, órdenes, conteos), que
--       seguían VISIBLES a usuarios normales (RLS solo oculta el padre); y
--   (b) extendió tg_heredar_es_prueba a proyecto_id/bodega_id ni lo enganchó a
--       las tablas derivadas → los derivados NUEVOS de un padre de prueba no
--       nacían 'heredado'.
-- Esta migración cierra ambos huecos. Aditiva y retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- 1) Consistencia de es_prueba_origen en las 8 entidades nuevas (Z5 las creó
--    nullable sin default). Backfill + default 'manual' como en X14. ----------
do $$
declare t text;
begin
  foreach t in array array['proyectos','bodegas','empleados','proveedores','ordenes_compra','articulos','activos_fijos','conteos_inventario'] loop
    execute format('update sgc.%I set es_prueba_origen = ''manual'' where es_prueba_origen is null', t);
    execute format('alter table sgc.%I alter column es_prueba_origen set default ''manual''', t);
  end loop;
end $$;

-- 2) tg_heredar_es_prueba: ahora también hereda de proyecto_id y bodega_id ----
--    (el cuerpo es defensivo: usa to_jsonb, si la FK no existe en la tabla el
--     lookup queda en null y se ignora). Retrocompatible con vehiculo/conductor.
create or replace function sgc.tg_heredar_es_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  j jsonb := to_jsonb(NEW);
  v_veh  uuid := nullif(j->>'vehiculo_id', '')::uuid;
  v_cond uuid := nullif(j->>'conductor_id', '')::uuid;
  v_proy uuid := nullif(j->>'proyecto_id', '')::uuid;
  v_bod  uuid := nullif(j->>'bodega_id', '')::uuid;
  v_parent boolean := false;
begin
  if coalesce((j->>'es_prueba')::boolean, false) then
    return NEW;  -- ya marcado explícitamente (manual)
  end if;
  if v_veh  is not null then v_parent := v_parent or coalesce((select es_prueba from sgc.vehiculos    where id = v_veh),  false); end if;
  if v_cond is not null then v_parent := v_parent or coalesce((select es_prueba from sgc.conductores   where id = v_cond), false); end if;
  if v_proy is not null then v_parent := v_parent or coalesce((select es_prueba from sgc.proyectos     where id = v_proy), false); end if;
  if v_bod  is not null then v_parent := v_parent or coalesce((select es_prueba from sgc.bodegas       where id = v_bod),  false); end if;
  if v_parent then
    NEW.es_prueba := true;
    NEW.es_prueba_origen := 'heredado';
  end if;
  return NEW;
end;
$function$;

-- 3) Enganchar el trigger de HERENCIA a las tablas derivadas de proyecto/bodega
--    que aún no lo tenían (BEFORE INSERT). Idempotente. ----------------------
do $$
declare t text;
begin
  foreach t in array array['bitacoras','cronograma_tareas','salidas_inventario','entradas_inventario','ordenes_compra','conteos_inventario'] loop
    execute format('drop trigger if exists trg_heredar_es_prueba on sgc.%I', t);
    execute format('create trigger trg_heredar_es_prueba before insert on sgc.%I for each row execute function sgc.tg_heredar_es_prueba()', t);
  end loop;
end $$;

-- 4) Enganchar el trigger de CASCADA (AFTER UPDATE OF es_prueba) a los nuevos
--    padres proyectos/bodegas → marcar/desmarcar propaga a derivados existentes.
drop trigger if exists trg_cascada_prueba on sgc.proyectos;
create trigger trg_cascada_prueba after update of es_prueba on sgc.proyectos
  for each row execute function sgc.tg_cascada_prueba();

drop trigger if exists trg_cascada_prueba on sgc.bodegas;
create trigger trg_cascada_prueba after update of es_prueba on sgc.bodegas
  for each row execute function sgc.tg_cascada_prueba();

-- 5) Backfill retroactivo: si ya hay proyectos/bodegas marcados como prueba,
--    propagar a sus derivados existentes (cierra la fuga en datos ya creados).
do $$
declare r record;
begin
  for r in select id from sgc.proyectos where coalesce(es_prueba,false) loop
    perform sgc._cascada_prueba('proyectos', r.id, true, false);
  end loop;
  for r in select id from sgc.bodegas where coalesce(es_prueba,false) loop
    perform sgc._cascada_prueba('bodegas', r.id, true, false);
  end loop;
end $$;
