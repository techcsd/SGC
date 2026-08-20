-- ============================================================================
-- Ronda 19/08/2026 — IDs AS · Backend batch (aditivo/idempotente)
--   AS5  — Rol "Logística y Transporte" (id 3): formalizar + ampliar accesos.
--   AS7  — Requisiciones: quién ve TODAS (bandeja global) + estado 'cerrada'.
--   AS15 — Registro de combustible: foto del tablero OBLIGATORIA server-side.
-- Decisiones de Xaviel (19/08): mantener el nombre "Logística y Transporte";
--   ven TODAS las requisiciones = admin/gerencia/dirección/compras-almacén
--   (vía módulo inventario) + logística + gerente_produccion + gerente_proyectos
--   + jefe_ingenieros; combustible = rechazo DURO en el servidor.
-- ============================================================================

set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────
-- AS5 — Rol Logística y Transporte
-- ─────────────────────────────────────────────────────────────────────────
-- El rol ya existe en prod (id=3). Este INSERT idempotente solo lo garantiza si
-- la BD se reconstruye desde sql/ (histórico: se sembró directo en prod, sin
-- migración → frágil). NO sobrescribe el nombre (Xaviel: mantenerlo).
insert into sgc.roles (codigo, nombre, modulos)
values ('logistica', 'Logística y Transporte', array['inventario'])
on conflict (codigo) do nothing;

-- Amplía módulos: + flota (paridad con jefe_flota — Raykler hace logística de
-- transporte real: seguimiento, rutas, conductores, conduces, combustible,
-- mantenimientos, avisos de vehículo, multas). Aditivo, sin duplicar.
update sgc.roles
   set modulos = (select array(select distinct e from unnest(modulos || array['flota']) e))
 where codigo = 'logistica'
   and not ('flota' = any(modulos));

-- es_flota_elevado(): + logistica (aprobado por Xaviel). Espejo obligatorio en
-- UserService.esFlotaElevado (front) — se actualiza en el mismo commit.
-- NOTA (follow-up): "elevado" incluye administración de vehículos; la matriz
-- pedía flota completo SALVO admin de vehículos. Refinamiento futuro = gate de
-- escritura de vehículos con un helper es_flota_admin() que excluya logística.
create or replace function sgc.es_flota_elevado()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo in ('admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica')
  );
$function$;
grant execute on function sgc.es_flota_elevado() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- AS7 — Requisiciones: visibilidad global + estado 'cerrada'
-- ─────────────────────────────────────────────────────────────────────────
-- Helper reutilizable (RLS + futura RPC de bandeja global). "Ven TODAS":
--   • módulo inventario  → admin, gerencia, dirección, coord_compras,
--                          guarda_almacen, logística (todos lo traen);
--   • roles de proyecto  → gerente_produccion, gerente_proyectos, jefe_ingenieros.
-- El ingeniero de campo NO entra aquí: sigue viendo solo las suyas
-- (solicitante_id = auth.uid()). El chofer, ninguna.
create or replace function sgc.puede_ver_todas_requisiciones()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or exists (
        select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = auth.uid()
          and r.codigo in ('gerente_produccion', 'gerente_proyectos', 'jefe_ingenieros')
      );
$function$;
grant execute on function sgc.puede_ver_todas_requisiciones() to authenticated;

-- Reescribe la policy de SELECT usando el helper (antes: inline is_admin OR
-- tiene_modulo('inventario') — dejaba fuera a los 3 roles de proyecto).
drop policy if exists "solicitudes_material: select" on sgc.solicitudes_material;
create policy "solicitudes_material: select" on sgc.solicitudes_material for select to authenticated
  using (solicitante_id = auth.uid() or sgc.puede_ver_todas_requisiciones());

-- Alinea el CHECK de estado con el modelo TS (que ya usa 'cerrada'). El estado
-- se creó inline, así que el nombre del constraint es el estándar de Postgres.
alter table sgc.solicitudes_material drop constraint if exists solicitudes_material_estado_check;
alter table sgc.solicitudes_material add constraint solicitudes_material_estado_check
  check (estado in ('pendiente', 'aprobada', 'rechazada', 'entregada', 'cerrada'));

-- ─────────────────────────────────────────────────────────────────────────
-- AS15 — Registro de combustible: foto del tablero OBLIGATORIA (server-side)
-- ─────────────────────────────────────────────────────────────────────────
-- Raíz: registrar_combustible_app aceptaba p_foto_tablero_path = null (solo la
-- UI web lo exigía). Un cliente que salte esa validación (app, replay idempotente
-- por client_uuid) creaba una echada sin evidencia. Xaviel: rechazo DURO en el
-- servidor. Un trigger BEFORE INSERT cubre TODOS los caminos de escritura (web y
-- app), no solo esa RPC. Solo aplica a inserts nuevos → no rompe el histórico
-- (esas echadas se auditan/reparan aparte, ver AS15.d).
create or replace function sgc.trg_combustible_requiere_tablero()
returns trigger
language plpgsql
as $function$
begin
  if new.foto_tablero_path is null or btrim(new.foto_tablero_path) = '' then
    raise exception 'La foto del tablero (odómetro/nivel) es obligatoria para registrar combustible.';
  end if;
  return new;
end;
$function$;

drop trigger if exists combustible_requiere_tablero on sgc.registros_combustible;
create trigger combustible_requiere_tablero
  before insert on sgc.registros_combustible
  for each row execute function sgc.trg_combustible_requiere_tablero();
