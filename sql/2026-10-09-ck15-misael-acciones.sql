-- 2026-10-09-ck15-misael-acciones.sql   ⚠️ LO APLICA EL PADRE (SGC) — regla 18/19
-- CK15 (app 2.46.0) — DOS acciones de Misael del spec (§CK15.2) que HOY NO tienen
-- hogar en el contrato `2026-10-08-ck15-trabajos-transporte.sql` y que la app dejó
-- SIN construir (nada de botones muertos):
--
--   A) "Ordenar" — el orden del día de Misael por arrastre/flechas. El contrato ya
--      creó `sgc.trabajos_manual.orden int` para las actividades manuales, pero:
--        • NO hay columna `orden` en `solicitudes_movimiento` (apoyos) ni en
--          `salidas_inventario` (requisiciones) → no se puede ordenar la bandeja
--          mezclada por una sola clave.
--        • NO hay RPC para fijar el orden.
--      `trabajos_transporte_listado` hoy ordena por `created_at desc` (fijo).
--
--   B) "Nota para el chofer" al asignar — el spec la pide, pero:
--        • `solicitudes_movimiento` (apoyos) NO tiene columna de nota de asignación;
--          `trabajo_asignar` no la recibe ni la persiste. Solo `trabajos_manual.nota`
--          existe (y `actividad_crear` no la expone). `mis_trabajos_chofer` ya lee
--          `trabajos_manual.nota` (y null para apoyos), así que el canal de lectura
--          del chofer YA está listo; falta el de ESCRITURA genérico.
--
-- Cambios ADITIVOS propuestos (verificados contra los cuerpos vivos del contrato
-- CK15 de arriba; no rompen el listado ni el asignar actuales):

begin;

-- ── A) Orden del día ───────────────────────────────────────────────────────────
-- Columna de orden en las fuentes que no la tienen (apoyos + requisiciones).
alter table sgc.solicitudes_movimiento add column if not exists orden int not null default 0;
alter table sgc.salidas_inventario     add column if not exists orden_transporte int not null default 0;
-- (trabajos_manual.orden ya existe en el contrato CK15.)

-- Exponer `orden` en el listado para que la app pueda pintar/ordenar por él. Hay que
-- RE-CREAR `trabajos_transporte_listado` sumando `orden` a cada rama del UNION y al
-- SELECT final (coalesce por rama), y cambiar el `order by` a `orden, created_at desc`.
-- (Se deja al PADRE re-crearla con el cuerpo vivo + esta sola adición — regla 19.)
--   t.orden = coalesce(apoyo.orden, 0) | coalesce(si.orden_transporte, 0) | coalesce(m.orden, 0)
--   ... order by t.orden, t.created_at desc;

-- RPC para fijar el orden de un ticket (o un lote). Gate es_flota_elevado().
create or replace function sgc.trabajo_ordenar(
  p_origen text, p_origen_id uuid, p_orden int)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if p_origen = 'apoyo' then
    update sgc.solicitudes_movimiento set orden = coalesce(p_orden,0) where id = p_origen_id;
  elsif p_origen = 'requisicion' then
    update sgc.salidas_inventario set orden_transporte = coalesce(p_orden,0) where id = p_origen_id;
  elsif p_origen = 'manual' then
    update sgc.trabajos_manual set orden = coalesce(p_orden,0), updated_at = now() where id = p_origen_id;
  else
    raise exception 'Origen inválido.' using errcode='22023';
  end if;
end;
$function$;
grant execute on function sgc.trabajo_ordenar(text,uuid,int) to authenticated, service_role;

-- ── B) Nota para el chofer al asignar ──────────────────────────────────────────
-- Columna de nota de asignación en los apoyos (requisiciones usan el flujo del
-- conduce; manual ya tiene `nota`).
alter table sgc.solicitudes_movimiento add column if not exists nota_chofer text;

-- Extender `trabajo_asignar` con un p_nota OPCIONAL al final. OJO (SGC): se DROPEA la
-- firma vieja de 5 args en la misma transacción — si no, un llamado de 5 args quedaría
-- AMBIGUO entre la 5-arg y la 6-arg-con-default (function is not unique). Verificado
-- regla 19: el cuerpo 6-arg == cuerpo vivo 5-arg + `nota_chofer`(apoyo)/`nota`(manual).
drop function if exists sgc.trabajo_asignar(text, uuid, uuid, uuid, date);
create or replace function sgc.trabajo_asignar(
  p_origen text, p_origen_id uuid, p_conductor_id uuid,
  p_vehiculo_id uuid default null, p_dia date default null, p_nota text default null)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_cond_usuario uuid;
begin
  if not sgc.es_flota_elevado() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if p_conductor_id is null then raise exception 'Elige un chofer.' using errcode='22023'; end if;

  if p_origen = 'apoyo' then
    perform sgc.planificar_solicitud_con_ruta(p_origen_id, p_vehiculo_id, p_conductor_id, p_dia, null);
    update sgc.solicitudes_movimiento set nota_chofer = nullif(trim(p_nota),'') where id = p_origen_id;
  elsif p_origen = 'requisicion' then
    perform sgc.asignar_chofer_conduce(p_origen_id, p_conductor_id, p_vehiculo_id);
  elsif p_origen = 'manual' then
    update sgc.trabajos_manual
       set conductor_id = p_conductor_id, vehiculo_id = p_vehiculo_id,
           estado = case when estado='pendiente' then 'asignada' else estado end,
           dia = coalesce(p_dia, dia),
           nota = coalesce(nullif(trim(p_nota),''), nota),
           updated_at = now()
     where id = p_origen_id;
    select usuario_id into v_cond_usuario from sgc.conductores where id = p_conductor_id;
    if v_cond_usuario is not null then
      perform sgc.notificar(v_cond_usuario, 'solicitud_movimiento', 'Actividad asignada',
        (select left(descripcion,80) from sgc.trabajos_manual where id=p_origen_id), '/transporte/mis-trabajos');
    end if;
  else
    raise exception 'Origen inválido.' using errcode='22023';
  end if;
end;
$function$;
grant execute on function sgc.trabajo_asignar(text,uuid,uuid,uuid,date,text) to authenticated, service_role;

-- NOTA para `mis_trabajos_chofer` (CK14): su rama 'apoyo' pasa `null::text nota` hoy;
-- cuando exista `solicitudes_movimiento.nota_chofer`, cambiarla a `s.nota_chofer` para
-- que el chofer vea la nota de Misael también en los apoyos (hoy solo la ve en manuales).

commit;

-- Consumo en la app (cuando esto esté en dev): el service `trabajos.service.ts` sumará
--   • `ordenar({origen,origenId,orden})` → `trabajo_ordenar` (+ UI de flechas/arrastre),
--   • `nota` opcional en `asignar(...)` → 6º arg `p_nota`,
-- ambos detrás de un capability-check (si el RPC/columna no está, se ocultan — como el
-- resto). Por eso la app 2.46.0 NO pinta hoy "Ordenar" ni "Nota para el chofer".
