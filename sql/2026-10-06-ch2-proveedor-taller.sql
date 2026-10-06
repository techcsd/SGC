-- ════════════════════════════════════════════════════════════════════════════
-- CH2 — Proveedor / Taller como dropdown real del maestro + "Otro". Nota #139.
--
--  • Nuevo tipo válido `taller` en `sgc.proveedores.tipos` (no hay CHECK sobre la
--    columna — es text[] libre; actualizamos el COMMENT, que es la fuente de la
--    lista de tipos válidos).
--  • `mantenimientos.proveedor_id` → FK opcional a `proveedores` (on delete set
--    null). Se conserva `proveedor` text (legacy + "Otro" escrito a mano).
--  • RPC DEFINER `listar_proveedores_para_flota()` para que la pantalla de
--    mantenimientos (web y app) liste talleres/proveedores sin depender del módulo
--    Compras: la política RLS de `proveedores` exige compras/inventario/elevado, y
--    un usuario de flota (incl. chofer en la app) no los tiene. El gate del RPC
--    abre la lectura a `flota` (y admin/elevado/compras/inventario).
--  • Param opcional `p_proveedor_id` en `crear_mantenimiento_app` (retrocompatible).
--
--  NO se marca ningún taller automáticamente: al final, una query lista los
--  nombres de `mantenimientos.proveedor` que casan (normalizados) con el maestro
--  para que Raykler confirme cuáles son talleres (👤). ADITIVO.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── (1) `taller` como tipo válido (la lista válida vive en el COMMENT) ────────
comment on column sgc.proveedores.tipos is
  'BF2/CH2 — tipos del proveedor (multiselección): ferreteria|suministros|transportista|taller|otro. is_hardware_store queda sincronizado con ''ferreteria''.';

-- ── (2) mantenimientos.proveedor_id (FK opcional; se mantiene `proveedor` text) ─
alter table sgc.mantenimientos
  add column if not exists proveedor_id uuid references sgc.proveedores(id) on delete set null;
create index if not exists idx_mantenimientos_proveedor_id on sgc.mantenimientos(proveedor_id);
comment on column sgc.mantenimientos.proveedor_id is
  'CH2 — taller/proveedor del maestro (opcional). Si es "Otro" (texto libre) queda null y el nombre va en `proveedor`.';

-- ── (3) Lista de talleres/proveedores para flota (web + app), RLS-safe ────────
-- DEFINER + gate flota: la pantalla de mantenimientos la usan usuarios de flota
-- que no tienen el módulo Compras (la política de `proveedores` lo exige). Solo
-- lectura, solo activos. El front agrupa Talleres primero.
create or replace function sgc.listar_proveedores_para_flota()
returns table(id uuid, nombre text, tipos text[], es_taller boolean)
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select p.id, p.nombre, coalesce(p.tipos,'{}'::text[]) as tipos,
         ('taller' = any(coalesce(p.tipos,'{}'::text[]))) as es_taller
  from sgc.proveedores p
  where coalesce(p.activo, true) and not coalesce(p.es_prueba, false)
    and (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_flota_elevado()
         or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario'))
  order by ('taller' = any(coalesce(p.tipos,'{}'::text[]))) desc, lower(p.nombre);
$function$;
grant execute on function sgc.listar_proveedores_para_flota() to authenticated, service_role;

-- ── (4) crear_mantenimiento_app: + p_proveedor_id/p_proveedor opcionales ──────
-- Se agregan 2 params con DEFAULT al final. Hay que DROPEAR el overload de 10-arg
-- para no dejar la función AMBIGUA (una llamada de 10-arg casaría con ambas). El
-- nuevo (12-arg) acepta las llamadas de 10-arg de la app (2 defaults). Guarda
-- proveedor_id + copia el nombre a `proveedor` (historial/export).
drop function if exists sgc.crear_mantenimiento_app(
  uuid, uuid, text, text, date, numeric, jsonb, timestamp with time zone, boolean, uuid);

create or replace function sgc.crear_mantenimiento_app(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date,
  p_km numeric, p_fotos jsonb, p_capturado_en timestamp with time zone,
  p_incluye_preventivo boolean default false, p_accidente_id uuid default null,
  p_proveedor_id uuid default null, p_proveedor text default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_tipo text; v_prov text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.mantenimientos where id = p_id) then
    return p_id;  -- idempotente
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  v_tipo := lower(coalesce(nullif(p_tipo,''),'preventivo'));
  if v_tipo not in ('preventivo','falla','accidente_dano','cambio_pieza','engrase','hidraulico','otros') then
    v_tipo := 'preventivo';
  end if;

  -- Nombre a persistir: el escrito, o el del maestro si vino proveedor_id.
  v_prov := nullif(p_proveedor,'');
  if v_prov is null and p_proveedor_id is not null then
    select nombre into v_prov from sgc.proveedores where id = p_proveedor_id;
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha,
    kilometraje_al_mantenimiento, estado, fotos, incluye_preventivo, accidente_id,
    proveedor_id, proveedor)
  values (
    p_id, p_vehiculo_id, v_tipo, p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}'),
    coalesce(p_incluye_preventivo, false), p_accidente_id,
    p_proveedor_id, v_prov
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);
  return p_id;
end;
$function$;
grant execute on function sgc.crear_mantenimiento_app(
  uuid, uuid, text, text, date, numeric, jsonb, timestamp with time zone,
  boolean, uuid, uuid, text
) to authenticated, service_role;

commit;

-- ── (5) 👤 Raykler: nombres de mantenimientos.proveedor que casan con el maestro
--     (normalizados, sin depender de la extensión unaccent). NO se marcan solos;
--     esta lista es para que confirme cuáles son talleres. Solo SELECT (no cambia
--     datos). Marcar un taller: update sgc.proveedores set tipos = array_append(tipos,'taller') where id = '…';
-- select distinct m.proveedor, p.id, p.nombre, p.tipos
--   from sgc.mantenimientos m
--   join sgc.proveedores p
--     on lower(regexp_replace(m.proveedor, '\s+', ' ', 'g')) =
--        lower(regexp_replace(p.nombre,    '\s+', ' ', 'g'))
--  where nullif(trim(m.proveedor),'') is not null and m.proveedor_id is null;
