-- ============================================================================
-- BA1 — Los ingenieros SÍ ven sus obras — cierre definitivo (AX3 → AY4 → BA1).
--
-- DIAGNÓSTICO (evidencia E2E): la relación N:M (AV3) y su migración de datos están
-- SANAS; los ingenieros reales SÍ ven sus obras reales por todos los caminos. Lo que
-- hacía "revivir" el bug era una TRAMPA DE VERIFICACIÓN: se probaba con el ingeniero
-- de PRUEBA (es_prueba=true) sobre una obra de PRUEBA, y una policy RESTRICTIVE sobre
-- sgc.proyectos oculta las obras es_prueba a TODO no-admin — SIN excepción para el
-- propio usuario de prueba. Resultado: el test siempre daba "invisible" aunque la
-- relación estuviera perfecta. Además: (B) el puente ingeniero_obra_id → relación era
-- best-effort del cliente (tragaba errores); (C) los distintos orígenes de dropdown
-- discrepaban SOLO en el manejo de es_prueba.
--
-- FIX (sin cambiar la visibilidad de NINGÚN rol sobre obras reales):
--  1. Helper usuario_actual_es_prueba() — ¿el usuario logueado es de prueba?
--  2. La regla es_prueba pasa a 3 vías en las 3 fuentes de lectura (RLS policy,
--     directorio_proyectos, proyectos_pickables): (NOT es_prueba) OR is_admin()
--     OR usuario_actual_es_prueba() → un usuario de prueba VE las obras de prueba,
--     y todo lo real queda EXACTAMENTE igual. Las 3 fuentes ahora concuerdan.
--  3. Puente autoritativo server-side: trigger sobre proyectos que, al setear
--     ingeniero_obra_id, asegura la fila activa en proyecto_responsables (ya no
--     depende del cliente). Cierra la columna "write-only".
-- ============================================================================

begin;
set local search_path = sgc, public;

-- (1) ¿El usuario logueado es de prueba? -------------------------------------
create or replace function sgc.usuario_actual_es_prueba()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce((select u.es_prueba from sgc.usuarios u where u.id = auth.uid()), false);
$$;
grant execute on function sgc.usuario_actual_es_prueba() to authenticated, service_role;

-- (2a) Policy RESTRICTIVE de es_prueba → 3 vías -------------------------------
drop policy if exists "es_prueba: oculta a no-admin" on sgc.proyectos;
create policy "es_prueba: oculta a no-admin" on sgc.proyectos
  as restrictive for select
  using ((not es_prueba) or sgc.is_admin() or sgc.usuario_actual_es_prueba());

-- (2b) directorio_proyectos → misma regla 3 vías -----------------------------
create or replace function sgc.directorio_proyectos()
 returns table(id uuid, codigo text, nombre text, estado text, ubicacion text, activo boolean, latitud numeric, longitud numeric)
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select p.id, p.codigo, p.nombre, p.estado, p.ubicacion, p.activo,
         p.latitud, p.longitud
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (not coalesce(p.es_prueba, false) or sgc.is_admin() or sgc.usuario_actual_es_prueba())
    and (
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('compras')   or sgc.tiene_modulo('direccion')
      or p.responsable_id = auth.uid()
      or exists (select 1 from sgc.proyecto_responsables pr
                 where pr.proyecto_id = p.id and pr.usuario_id = auth.uid()
                   and coalesce(pr.activo, true))
      or exists (select 1 from sgc.proyecto_empleados pe
                 join sgc.empleados e on e.id = pe.empleado_id
                 where pe.proyecto_id = p.id and e.usuario_id = auth.uid())
    )
  order by p.nombre;
$function$;

-- (2c) proyectos_pickables (app) → misma regla 3 vías ------------------------
-- Mismo cuerpo que AY4 (follow-up), solo cambia la cláusula es_prueba a 3 vías.
create or replace function sgc.proyectos_pickables()
returns table(id uuid, nombre text, responsable_nombre text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select p.id, p.nombre::text, p.responsable_nombre::text
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (not coalesce(p.es_prueba, false) or sgc.is_admin() or sgc.usuario_actual_es_prueba())
    and (
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('compras')   or sgc.tiene_modulo('direccion')
      or sgc.es_responsable_de_proyecto(p.id)
      or sgc.es_capataz_de_proyecto(p.id)
      or exists (select 1 from sgc.proyecto_empleados pe
                 join sgc.empleados e on e.id = pe.empleado_id
                 where pe.proyecto_id = p.id and e.usuario_id = auth.uid())
      -- Red de seguridad AW1 ("vacío ≠ error"): sin ninguna obra ligada → ve todas.
      or not exists (
        select 1 from sgc.proyectos p2
        where coalesce(p2.activo, true)
          and (sgc.es_responsable_de_proyecto(p2.id) or sgc.es_capataz_de_proyecto(p2.id)
               or exists (select 1 from sgc.proyecto_empleados pe2
                          join sgc.empleados e2 on e2.id = pe2.empleado_id
                          where pe2.proyecto_id = p2.id and e2.usuario_id = auth.uid()))
      )
    )
  order by p.nombre;
$function$;

-- (3) Puente autoritativo: ingeniero_obra_id → proyecto_responsables ---------
-- Cierra la columna "write-only" (AZ9): antes dependía de un mejor-esfuerzo del
-- cliente que tragaba errores; ahora la BD garantiza la fila activa en la relación
-- que alimenta la visibilidad (RLS/directorio). Idempotente y aditivo (no desactiva
-- responsables previos: al reasignar, agrega el nuevo — la baja es manual).
create or replace function sgc.trg_proyecto_bridge_responsable()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if new.ingeniero_obra_id is not null
     and (tg_op = 'INSERT' or new.ingeniero_obra_id is distinct from old.ingeniero_obra_id) then
    if not exists (
      select 1 from sgc.proyecto_responsables pr
      where pr.proyecto_id = new.id
        and pr.usuario_id = new.ingeniero_obra_id
        and coalesce(pr.activo, true)
    ) then
      insert into sgc.proyecto_responsables
        (proyecto_id, usuario_id, tipo_responsabilidad, activo, es_principal, desde, creado_por)
      values
        (new.id, new.ingeniero_obra_id, 'responsable', true, false, current_date, auth.uid());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proyecto_bridge_responsable on sgc.proyectos;
create trigger trg_proyecto_bridge_responsable
  after insert or update of ingeniero_obra_id on sgc.proyectos
  for each row execute function sgc.trg_proyecto_bridge_responsable();

-- Backfill: cualquier proyecto con ingeniero_obra_id set y SIN su fila activa
-- de responsable (el hueco que dejaba el puente best-effort) queda cubierto ahora.
insert into sgc.proyecto_responsables
  (proyecto_id, usuario_id, tipo_responsabilidad, activo, es_principal, desde, creado_por)
select p.id, p.ingeniero_obra_id, 'responsable', true, false, current_date, null
from sgc.proyectos p
where p.ingeniero_obra_id is not null
  and not exists (
    select 1 from sgc.proyecto_responsables pr
    where pr.proyecto_id = p.id and pr.usuario_id = p.ingeniero_obra_id
      and coalesce(pr.activo, true)
  );

commit;
