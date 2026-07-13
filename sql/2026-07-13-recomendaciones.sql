-- ============================================================================
-- Recomendaciones post-revisión (07/07/2026) — 5 mejoras. Todo aditivo/seguro.
--  1) Requisición ↔ Equipo de Obra (enforcement con parámetro, default OFF).
--  2) cuadre_obra.fase_activa auto-avanza según el % de avance real del proyecto.
--  3) Estado terminal 'cerrada' de la requisición (auto al confirmar la entrega).
--  4) Reposición usa el mínimo del kit del cuadre (RPC security definer, apta obra).
--  5) Entidades roadmap CL-01..07: obra_elementos / obra_vaciados / obra_no_conformidades.
-- ============================================================================
set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Requisición solo por el Ingeniero Residente/Responsable (opt-in)
-- ─────────────────────────────────────────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('requisicion_validar_equipo', 'false',
   'Si "true", solo el Ingeniero Residente/Responsable asignado al proyecto (o Almacén/Admin) puede crear requisiciones. Proyectos sin equipo definido no se bloquean.')
on conflict (clave) do nothing;

create or replace function sgc.requisicion_permitida(p_proyecto_id uuid, p_usuario uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_on boolean;
begin
  select coalesce((select valor from sgc.parametros where clave = 'requisicion_validar_equipo'), 'false') = 'true'
    into v_on;
  if not v_on then return true; end if;   -- control apagado → siempre permitido

  return (
    sgc.is_admin()
    or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = p_proyecto_id
        and pe.rol in ('ing_residente', 'ing_responsable')
        and e.usuario_id = p_usuario
        and coalesce(pe.activo, true)
    )
    -- gracia: proyecto sin Residente/Responsable definido → no bloquear
    or not exists (
      select 1 from sgc.proyecto_empleados pe
      where pe.proyecto_id = p_proyecto_id and pe.rol in ('ing_residente', 'ing_responsable')
    )
  );
end;
$$;
grant execute on function sgc.requisicion_permitida(uuid, uuid) to authenticated, service_role;

-- web (invoker)
create or replace function sgc.crear_solicitud_material(p_proyecto_id uuid, p_solicitante_id uuid, p_urgencia text, p_notas text, p_items jsonb)
returns uuid language plpgsql
as $$
declare v_solicitud_id uuid;
begin
  if not sgc.requisicion_permitida(p_proyecto_id, p_solicitante_id) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;
  insert into sgc.solicitudes_material (proyecto_id, solicitante_id, urgencia, notas)
  values (p_proyecto_id, p_solicitante_id, p_urgencia, p_notas)
  returning id into v_solicitud_id;
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad)
  select v_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad'
  from jsonb_array_elements(p_items) as i;
  return v_solicitud_id;
end;
$$;

-- app de campo (definer) — mantiene idempotencia; check tras verificar módulo
create or replace function sgc.crear_solicitud_app(p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb)
returns uuid language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('compras') then
    raise exception 'Tu usuario no tiene el módulo Solicitudes';
  end if;
  if exists (select 1 from sgc.solicitudes_material where id = p_id) then
    return p_id;  -- idempotente: reenvío de op ya aceptada
  end if;
  if not sgc.requisicion_permitida(p_proyecto_id, auth.uid()) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;

  insert into sgc.solicitudes_material (id, proyecto_id, solicitante_id, estado, urgencia, notas)
  values (p_id, p_proyecto_id, auth.uid(), 'pendiente', coalesce(p_urgencia, 'normal'), p_notas);
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad)
  select p_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad'
  from jsonb_array_elements(p_items) as i;
  return p_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fase_activa automática según el avance real del proyecto
-- ─────────────────────────────────────────────────────────────────────────────
alter table sgc.cuadre_obra add column if not exists fase_auto boolean not null default true;

create or replace function sgc.fase_por_avance(p_proyecto_id uuid)
returns int language sql stable
as $$
  select case
           when a.avg_prog is null then null
           when a.avg_prog < 25 then 1
           when a.avg_prog < 50 then 2
           when a.avg_prog < 75 then 3
           else 4
         end
  from (select avg(progreso)::numeric as avg_prog from sgc.fases_proyecto where proyecto_id = p_proyecto_id) a;
$$;

create or replace function sgc.trg_cuadre_fase_auto()
returns trigger language plpgsql
as $$
declare v_proy uuid := coalesce(NEW.proyecto_id, OLD.proyecto_id);
begin
  update sgc.cuadre_obra c
     set fase_activa = coalesce(sgc.fase_por_avance(v_proy), c.fase_activa),
         updated_at = now()
   where c.proyecto_id = v_proy and c.fase_auto = true;
  return null;
end;
$$;
drop trigger if exists trg_fases_cuadre_fase on sgc.fases_proyecto;
create trigger trg_fases_cuadre_fase
  after insert or update or delete on sgc.fases_proyecto
  for each row execute function sgc.trg_cuadre_fase_auto();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Estado 'cerrada' (cierre automático al confirmar la entrega)
-- ─────────────────────────────────────────────────────────────────────────────
alter table sgc.solicitudes_material drop constraint if exists solicitudes_material_estado_check;
alter table sgc.solicitudes_material add constraint solicitudes_material_estado_check
  check (estado = any (array['pendiente','aprobada','rechazada','entregada','cerrada']));

create or replace function sgc.trg_cerrar_requisicion()
returns trigger language plpgsql
as $$
begin
  if NEW.estado = 'entregado' and (OLD.estado is distinct from 'entregado') then
    update sgc.solicitudes_material sm
       set estado = 'cerrada', updated_at = now()
     where sm.salida_id = NEW.id
       and sm.estado in ('aprobada', 'entregada')
       and (sm.solicitud_compra_id is null
            or not exists (select 1 from sgc.solicitudes_compra sc
                            where sc.id = sm.solicitud_compra_id and sc.estado = 'pendiente'));
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_salida_cierra_requisicion on sgc.salidas_inventario;
create trigger trg_salida_cierra_requisicion
  after update on sgc.salidas_inventario
  for each row execute function sgc.trg_cerrar_requisicion();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Reposición con mínimo del kit (RPC security definer, apta para obra)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sgc.reposicion_almacen(p_bodega_id uuid)
returns table (articulo_id uuid, nombre text, codigo text, unidad text, minimo numeric, actual numeric, faltante numeric)
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_proy uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid())) then
    raise exception 'No autorizado';
  end if;

  select proyecto_id into v_proy from sgc.cuadre_obra where bodega_id = p_bodega_id limit 1;

  return query
    with kit_min as (
      select ci.articulo_id, sum(ci.cantidad_total) as min_kit
      from sgc.cuadre_items ci
      where ci.proyecto_id = v_proy and ci.es_min_stock and ci.articulo_id is not null
      group by ci.articulo_id
    )
    select a.id,
           a.nombre::text,
           a.codigo::text,
           a.unidad::text,
           greatest(a.stock_minimo, coalesce(k.min_kit, 0))                                  as minimo,
           coalesce(s.cantidad, 0)                                                            as actual,
           greatest(0, greatest(a.stock_minimo, coalesce(k.min_kit, 0)) - coalesce(s.cantidad, 0)) as faltante
    from sgc.articulos a
    left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    left join kit_min k on k.articulo_id = a.id
    where a.activo
      and greatest(a.stock_minimo, coalesce(k.min_kit, 0)) > 0
      and coalesce(s.cantidad, 0) <= greatest(a.stock_minimo, coalesce(k.min_kit, 0))
    order by faltante desc;
end;
$$;
grant execute on function sgc.reposicion_almacen(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Entidades roadmap para CL-01..07 / Registro de Vaciado (esquema, sin UI aún)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.obra_elementos (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  tipo        text,   -- excavacion|fundacion|columna|viga|losa|muro|escalera|otro
  codigo      text,   -- identificador del elemento
  eje         text,
  bloque      text,   -- edificio / bloque
  descripcion text,
  created_at  timestamptz not null default now()
);

create table if not exists sgc.obra_vaciados (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  elemento_id uuid references sgc.obra_elementos(id) on delete set null,
  numero      int,    -- N° de vaciado
  fecha       date,
  estado      text not null default 'planificado',  -- planificado|liberado|vaciado|anulado
  notas       text,
  created_at  timestamptz not null default now(),
  constraint obra_vaciados_estado_chk check (estado in ('planificado','liberado','vaciado','anulado'))
);
create index if not exists idx_obra_vaciados_proyecto on sgc.obra_vaciados(proyecto_id);

create table if not exists sgc.obra_no_conformidades (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  elemento_id uuid references sgc.obra_elementos(id) on delete set null,
  vaciado_id  uuid references sgc.obra_vaciados(id) on delete set null,
  descripcion text not null,
  severidad   text not null default 'media',
  estado      text not null default 'abierta',      -- abierta|cerrada
  -- regla de oro: una NC abierta bloquea el vaciado
  bloquea_vaciado boolean not null default true,
  creado_por  uuid references sgc.usuarios(id),
  cerrada_en  timestamptz,
  created_at  timestamptz not null default now(),
  constraint obra_nc_estado_chk check (estado in ('abierta','cerrada'))
);
create index if not exists idx_obra_nc_proyecto on sgc.obra_no_conformidades(proyecto_id);

-- RLS: obra (bitacora) + proyectos + admin. Se refinará al construir las features.
do $$ begin
  execute 'alter table sgc.obra_elementos enable row level security';
  execute 'alter table sgc.obra_vaciados enable row level security';
  execute 'alter table sgc.obra_no_conformidades enable row level security';
exception when others then null; end $$;

drop policy if exists obra_elem_all on sgc.obra_elementos;
create policy obra_elem_all on sgc.obra_elementos for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'));
drop policy if exists obra_vac_all on sgc.obra_vaciados;
create policy obra_vac_all on sgc.obra_vaciados for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'));
drop policy if exists obra_nc_all on sgc.obra_no_conformidades;
create policy obra_nc_all on sgc.obra_no_conformidades for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'));

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.obra_elementos, sgc.obra_vaciados, sgc.obra_no_conformidades to authenticated;
grant all on sgc.obra_elementos, sgc.obra_vaciados, sgc.obra_no_conformidades to service_role;
