-- ============================================================================
-- A5 — Chequeo semanal de almacenes — reunión 07/07/2026
-- ----------------------------------------------------------------------------
-- Conteo físico vs sistema por almacén (sobre conteos_inventario). Las
-- diferencias alimentan el motor de alertas (A4). Tarea recurrente semanal al
-- Guarda-Almacén de cada obra (vía pg_cron + módulo Tareas).
-- ============================================================================
set search_path = sgc, public;

-- 1) Extiende conteos con tipo/observaciones --------------------------------
alter table sgc.conteos_inventario
  add column if not exists tipo text not null default 'ajuste',   -- 'ajuste' | 'chequeo_semanal'
  add column if not exists observaciones text;

-- 2) Alertas: permitir alertas por almacén (no solo por proyecto) ------------
alter table sgc.alertas_cuadre alter column proyecto_id drop not null;
alter table sgc.alertas_cuadre add column if not exists bodega_id uuid references sgc.bodegas(id);

-- 3) RPC chequeo semanal (web + futura CSD App) ------------------------------
create or replace function sgc.registrar_chequeo_semanal(
  p_id uuid, p_bodega_id uuid, p_observaciones text, p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_item    jsonb;
  v_antes   numeric;
  v_contada numeric;
  v_diff    numeric;
  v_proy    uuid;
  v_nombre  text;
  v_sev     text;
  v_open_id uuid;
  v_bodega  text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.conteos_inventario where id = p_id) then
    return p_id;  -- idempotente
  end if;

  select proyecto_id into v_proy from sgc.cuadre_obra where bodega_id = p_bodega_id limit 1;
  select nombre into v_bodega from sgc.bodegas where id = p_bodega_id;

  insert into sgc.conteos_inventario (id, bodega_id, motivo, tipo, observaciones, creado_por)
  values (p_id, p_bodega_id, 'Chequeo semanal', 'chequeo_semanal', p_observaciones, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_contada := (v_item->>'cantidad_contada')::numeric;
    select coalesce(cantidad, 0) into v_antes
      from sgc.stock_por_bodega
     where articulo_id = (v_item->>'articulo_id')::uuid and bodega_id = p_bodega_id;
    v_antes := coalesce(v_antes, 0);

    insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada)
    values (p_id, (v_item->>'articulo_id')::uuid, v_antes, v_contada);

    v_diff := v_contada - v_antes;
    if v_diff <> 0 then
      -- ajustar stock al conteo físico
      perform sgc.adjust_stock((v_item->>'articulo_id')::uuid, p_bodega_id, v_diff);

      -- alerta de diferencia (falta = más grave que sobra)
      v_sev := case when v_diff < 0 then 'alerta' else 'advertencia' end;
      select nombre into v_nombre from sgc.articulos where id = (v_item->>'articulo_id')::uuid;

      select id into v_open_id from sgc.alertas_cuadre
       where bodega_id = p_bodega_id and articulo_id = (v_item->>'articulo_id')::uuid
         and tipo = 'chequeo_diferencia' and estado <> 'resuelta' limit 1;

      if v_open_id is not null then
        update sgc.alertas_cuadre
           set severidad = v_sev, estimado = v_antes, consumido = v_contada,
               desviacion_pct = null, mensaje =
                 format('Diferencia en chequeo de %s: %s — sistema %s vs físico %s (%s %s).',
                        coalesce(v_bodega,'almacén'), coalesce(v_nombre,'artículo'), v_antes, v_contada,
                        case when v_diff < 0 then 'faltan' else 'sobran' end, abs(v_diff)),
               updated_at = now()
         where id = v_open_id;
      else
        insert into sgc.alertas_cuadre
          (proyecto_id, bodega_id, articulo_id, tipo, severidad, estimado, consumido, mensaje)
        values
          (v_proy, p_bodega_id, (v_item->>'articulo_id')::uuid, 'chequeo_diferencia', v_sev, v_antes, v_contada,
           format('Diferencia en chequeo de %s: %s — sistema %s vs físico %s (%s %s).',
                  coalesce(v_bodega,'almacén'), coalesce(v_nombre,'artículo'), v_antes, v_contada,
                  case when v_diff < 0 then 'faltan' else 'sobran' end, abs(v_diff)));
      end if;
    end if;
  end loop;

  return p_id;
end;
$$;
grant execute on function sgc.registrar_chequeo_semanal(uuid, uuid, text, jsonb) to authenticated, service_role;

-- 4) Generación de tareas recurrentes de chequeo semanal ---------------------
-- Una tarea por almacén de obra (cuadre_obra.bodega_id) asignada al Guarda-Almacén
-- del proyecto. Evita duplicar si ya hay una tarea de chequeo abierta esta semana.
create or replace function sgc.generar_tareas_chequeo_semanal()
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  r record;
  v_uid uuid;
  v_count int := 0;
begin
  for r in
    select c.proyecto_id, c.bodega_id, p.nombre as proyecto_nombre, b.nombre as bodega_nombre
    from sgc.cuadre_obra c
    join sgc.proyectos p on p.id = c.proyecto_id and p.activo and p.estado in ('planificacion','en_progreso','pausado')
    join sgc.bodegas b on b.id = c.bodega_id
    where c.bodega_id is not null
  loop
    -- Guarda-Almacén del proyecto → usuario
    select e.usuario_id into v_uid
      from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
     where pe.proyecto_id = r.proyecto_id and pe.rol = 'guarda_almacen'
       and e.usuario_id is not null
     limit 1;
    if v_uid is null then continue; end if;

    -- ¿ya hay tarea de chequeo abierta creada en los últimos 6 días para este proyecto?
    if exists (
      select 1 from sgc.tareas t
       where t.proyecto_id = r.proyecto_id and t.asignado_a = v_uid
         and t.titulo like 'Chequeo semanal de almacén%'
         and t.estado in ('pendiente','en_progreso')
         and t.created_at > now() - interval '6 days'
    ) then continue; end if;

    insert into sgc.tareas (titulo, descripcion, estado, prioridad, asignado_a, asignado_por, proyecto_id, fecha_limite)
    values (
      'Chequeo semanal de almacén — ' || r.bodega_nombre,
      'Conteo físico vs sistema del almacén de obra. Registra las diferencias en Inventario → Conteos → Nuevo chequeo semanal.',
      'pendiente', 'media', v_uid, v_uid, r.proyecto_id, (current_date + 2)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
grant execute on function sgc.generar_tareas_chequeo_semanal() to service_role;

-- 5) Cron semanal (lunes 06:00) ---------------------------------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'chequeo-semanal-almacenes') then
    perform cron.unschedule('chequeo-semanal-almacenes');
  end if;
end $$;
select cron.schedule('chequeo-semanal-almacenes', '0 6 * * 1', $cron$ select sgc.generar_tareas_chequeo_semanal(); $cron$);
