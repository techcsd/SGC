-- BV8 — "Materiales a cargo del ingeniero": lo que se recibió en SUS obras y aún no se
-- devolvió. Derivado (no una tabla nueva): recibido en la obra − devuelto desde la obra,
-- por artículo. Cada ingeniero ve las obras de las que es responsable; admin/dirección
-- pueden consultar las de otro (p_usuario_id).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv8-materiales-a-cargo.sql --env dev  →  --env prod
begin;

create or replace function sgc.materiales_a_cargo(p_usuario_id uuid default null)
 returns table(proyecto_id uuid, proyecto text, articulo_id uuid, articulo text, unidad text, cantidad numeric)
 language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := coalesce(p_usuario_id, auth.uid());
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  -- Ver los materiales de OTRO usuario requiere rol de mando.
  if v_uid <> auth.uid() and not (sgc.is_admin() or sgc.tiene_modulo('direccion')) then
    raise exception 'No puedes ver los materiales a cargo de otro usuario.' using errcode = '42501';
  end if;

  return query
  with obras as (
    select pr.proyecto_id
    from sgc.proyecto_responsables pr
    where pr.usuario_id = v_uid and coalesce(pr.activo, true)
  ),
  recibido as (
    select s.proyecto_id, ds.articulo_id, sum(coalesce(ds.cantidad,0)) as cant
    from sgc.salidas_inventario s
    join sgc.detalle_salidas ds on ds.salida_id = s.id
    where s.proyecto_id in (select o.proyecto_id from obras o)
      and s.recibido_por is not null
      and s.anulado_por is null
    group by s.proyecto_id, ds.articulo_id
  ),
  devuelto as (
    select e.origen_proyecto_id as proyecto_id, de.articulo_id, sum(coalesce(de.cantidad,0)) as cant
    from sgc.entradas_inventario e
    join sgc.detalle_entradas de on de.entrada_id = e.id
    where e.origen_proyecto_id in (select o.proyecto_id from obras o)
      and coalesce(e.origen_tipo,'') = 'devolucion_obra'
    group by e.origen_proyecto_id, de.articulo_id
  )
  select r.proyecto_id, p.nombre::text, r.articulo_id, a.nombre::text, a.unidad::text,
         (r.cant - coalesce(d.cant, 0)) as cantidad
  from recibido r
  join sgc.proyectos p on p.id = r.proyecto_id
  join sgc.articulos a on a.id = r.articulo_id
  left join devuelto d on d.proyecto_id = r.proyecto_id and d.articulo_id = r.articulo_id
  where (r.cant - coalesce(d.cant, 0)) > 0
  order by p.nombre, a.nombre;
end $function$;

grant execute on function sgc.materiales_a_cargo(uuid) to authenticated, service_role;

commit;
