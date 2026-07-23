-- ============================================================================
-- W7 — Datos de prueba v2: aislamiento total del dominio Flota (refina T2)
-- ----------------------------------------------------------------------------
-- T2/T2b dejaron: es_prueba en 13 tablas + RLS restrictiva de SELECT
--   (`(not es_prueba) or is_admin()`) + marcar/eliminar_dato_prueba.
-- Faltaba (esta migración, todo aditivo/retrocompatible):
--   (1) PROPAGACIÓN: lo derivado de una entidad test nace test (trigger genérico
--       que hereda es_prueba del vehículo/conductor padre).
--   (2) FUGA por RPCs SECURITY DEFINER (bypassean la RLS): los pickers y listas
--       de la app (flota_placas, mis_rutas_hoy, mis_pendientes_transporte,
--       mis_conduces_hoy, vehiculo_estado_actual) devolvían entidades test a
--       usuarios normales. Se filtra `(not es_prueba) or is_admin()`.
--   (3) AGREGADOS/EFECTOS: un vehículo test NO debe generar avisos reales de
--       mantenimiento/consumo ni notificaciones. Se suprime el bloque de avisos
--       en checklist/combustible cuando el vehículo es de prueba, y se marca
--       (es_prueba) la tabla avisos_flota como red de seguridad.
-- ============================================================================

set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────
-- (1) Propagación genérica de es_prueba a lo derivado.
--     Un trigger BEFORE INSERT único, reutilizable: lee vehiculo_id/conductor_id
--     de la fila entrante (vía to_jsonb, tolerante a tablas sin esas columnas) y
--     hereda es_prueba del padre. Si ya venía marcada como prueba, la respeta.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sgc.tg_heredar_es_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  j jsonb := to_jsonb(NEW);
  v_veh uuid  := nullif(j->>'vehiculo_id', '')::uuid;
  v_cond uuid := nullif(j->>'conductor_id', '')::uuid;
  v_parent boolean := false;
begin
  -- Ya marcada explícitamente como prueba → respetar.
  if coalesce((j->>'es_prueba')::boolean, false) then
    return NEW;
  end if;
  if v_veh is not null then
    v_parent := v_parent or coalesce((select es_prueba from sgc.vehiculos where id = v_veh), false);
  end if;
  if v_cond is not null then
    v_parent := v_parent or coalesce((select es_prueba from sgc.conductores where id = v_cond), false);
  end if;
  if v_parent then
    NEW.es_prueba := true;
  end if;
  return NEW;
end;
$function$;

-- Adjuntar el trigger a las tablas derivadas con padre vehículo/conductor.
do $do$
declare t text;
begin
  foreach t in array array[
    'checklists_vehiculo','registros_combustible','vehiculo_entregas','rutas',
    'mantenimientos','vehiculo_accidentes','vehiculo_danos','conductor_multas'
  ] loop
    execute format('drop trigger if exists trg_heredar_es_prueba on sgc.%I', t);
    execute format(
      'create trigger trg_heredar_es_prueba before insert on sgc.%I
         for each row execute function sgc.tg_heredar_es_prueba()', t);
  end loop;
end;
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- (3a) avisos_flota: marca + oculta a no-admin (red de seguridad para cualquier
--      aviso de un vehículo test que se cuele por vías no cubiertas).
-- ─────────────────────────────────────────────────────────────────────────
alter table sgc.avisos_flota add column if not exists es_prueba boolean not null default false;
create index if not exists idx_avisos_flota_es_prueba on sgc.avisos_flota(es_prueba) where es_prueba;

drop trigger if exists trg_heredar_es_prueba on sgc.avisos_flota;
create trigger trg_heredar_es_prueba before insert on sgc.avisos_flota
  for each row execute function sgc.tg_heredar_es_prueba();

alter table sgc.avisos_flota enable row level security;
drop policy if exists "es_prueba: oculta a no-admin" on sgc.avisos_flota;
create policy "es_prueba: oculta a no-admin" on sgc.avisos_flota
  as restrictive for select using ((not es_prueba) or sgc.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- (2) Fuga en RPCs SECURITY DEFINER (pickers/listas de la app).
-- ─────────────────────────────────────────────────────────────────────────

-- Picker de vehículos de la app: NO mostrar vehículos test a no-admin.
create or replace function sgc.flota_placas()
returns table(id uuid, placa text, marca text, modelo text, activo boolean)
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select v.id, v.placa, v.marca, v.modelo, coalesce(v.activo, true)
  from sgc.vehiculos v
  where (sgc.is_admin() or sgc.tiene_modulo('flota'))
    and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
$function$;

-- Rutas de hoy del chofer.
create or replace function sgc.mis_rutas_hoy()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'origen', r.origen, 'destino', r.destino,
    'estado', r.estado, 'fecha', r.fecha, 'notas', r.notas) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  where r.fecha = current_date
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
    and ((not coalesce(r.es_prueba, false)) or sgc.is_admin());
$function$;

-- Pendientes de transporte del chofer (vehículos a su cargo / por recibir).
create or replace function sgc.mis_pendientes_transporte()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'public'
as $function$
  select jsonb_build_object(
    'a_cargo', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entrega_id', e.id, 'vehiculo_id', v.id, 'placa', v.placa,
        'marca', v.marca, 'modelo', v.modelo, 'km', e.km, 'desde', e.capturado_en)), '[]'::jsonb)
      from sgc.vehiculo_entregas e
      join sgc.vehiculos v on v.id = e.vehiculo_id
      where e.conductor_usuario_id = auth.uid() and e.tipo = 'recepcion' and e.estado = 'abierta'
        and ((not coalesce(e.es_prueba, false)) or sgc.is_admin())
        and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
    ),
    'por_recibir', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
        'modelo', v.modelo, 'km', v.kilometraje)), '[]'::jsonb)
      from sgc.vehiculos v
      where v.responsable_id = auth.uid() and coalesce(v.activo, true)
        and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
        and not exists (
          select 1 from sgc.vehiculo_entregas e
          where e.vehiculo_id = v.id and e.tipo = 'recepcion' and e.estado = 'abierta')
    )
  );
$function$;

-- Conduces de hoy del chofer.
create or replace function sgc.mis_conduces_hoy()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'fecha', s.fecha, 'estado', s.estado,
    'destino', p.nombre, 'bodega', b.nombre,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'detalle_id', d.id, 'articulo', a.nombre, 'unidad', a.unidad, 'cantidad', d.cantidad)), '[]'::jsonb)
      from sgc.detalle_salidas d
      join sgc.articulos a on a.id = d.articulo_id
      where d.salida_id = s.id
    )
  ) order by s.fecha desc), '[]'::jsonb)
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  where s.estado = 'despachado'
    and s.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin());
$function$;

-- Estado actual de un vehículo (oculta la entrega abierta si es test para no-admin).
create or replace function sgc.vehiculo_estado_actual(p_vehiculo_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'public'
as $function$
  select jsonb_build_object(
    'vehiculo_id', v.id,
    'placa', v.placa,
    'km', v.kilometraje,
    'responsable_id', v.responsable_id,
    'responsable', (select nombre from sgc.usuarios where id = v.responsable_id),
    'entrega_abierta', (
      select to_jsonb(e) from sgc.vehiculo_entregas e
      where e.vehiculo_id = v.id and e.tipo = 'recepcion' and e.estado = 'abierta'
        and ((not coalesce(e.es_prueba, false)) or sgc.is_admin())
      order by e.created_at desc limit 1
    )
  )
  from sgc.vehiculos v
  where v.id = p_vehiculo_id
    and ((not coalesce(v.es_prueba, false)) or sgc.is_admin());
$function$;
