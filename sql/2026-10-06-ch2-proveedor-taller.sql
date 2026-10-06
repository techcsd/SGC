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

-- ── (4) crear_mantenimiento_app: canónica con p_proveedor_id (reconcilia dev/prod) ──
-- REGLA 19: dev y prod YA tenían la versión de 13-arg (p_costo/p_proveedor/p_notas +
-- lógica AL7: un no-elevado solo registra su vehículo en uso, tipos extendidos, aviso
-- al jefe de flota). Una 1ª versión de esta migración añadió por error un overload de
-- 12-arg SIMPLIFICADO en dev (quedó AMBIGUO y habría regresado la lógica de prod).
-- Aquí dropeamos TODOS los overloads conocidos y dejamos UNA sola función canónica =
-- la de 13-arg íntegra + `p_proveedor_id` (CH2), idéntica en ambos entornos.
drop function if exists sgc.crear_mantenimiento_app(uuid,uuid,text,text,date,numeric,jsonb,timestamp with time zone,boolean,uuid);                   -- 10-arg legacy (si existiera)
drop function if exists sgc.crear_mantenimiento_app(uuid,uuid,text,text,date,numeric,jsonb,timestamp with time zone,boolean,uuid,uuid,text);         -- 12-arg (bug de la 1ª versión en dev)
drop function if exists sgc.crear_mantenimiento_app(uuid,uuid,text,text,date,numeric,jsonb,timestamp with time zone,boolean,uuid,numeric,text,text);  -- 13-arg actual (dev + prod)

create or replace function sgc.crear_mantenimiento_app(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date,
  p_km numeric, p_fotos jsonb, p_capturado_en timestamp with time zone,
  p_incluye_preventivo boolean default false, p_accidente_id uuid default null,
  p_costo numeric default null, p_proveedor text default null, p_notas text default null,
  p_proveedor_id uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tipo text; v_elevado boolean; v_en_uso boolean; v_resp boolean;
  v_veh_nombre text; v_yo text; v_r record; v_prov text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  v_elevado := sgc.is_admin() or sgc.tiene_modulo('flota');

  if exists (select 1 from sgc.mantenimientos where id = p_id) then
    return p_id;  -- idempotente
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- AL7: un no-elevado solo registra sobre su vehículo EN USO (AK20) o del que es
  -- responsable actual (bridge vehiculos.responsable_id).
  if not v_elevado then
    v_en_uso := exists (select 1 from sgc.vehiculo_usos vu
                        where vu.vehiculo_id = p_vehiculo_id and vu.usuario_id = v_uid and vu.fin_at is null);
    v_resp   := exists (select 1 from sgc.vehiculos v
                        where v.id = p_vehiculo_id and v.responsable_id = v_uid);
    if not (v_en_uso or v_resp) then
      raise exception 'Solo puedes registrar mantenimientos del vehículo que tienes en uso.';
    end if;
  end if;

  v_tipo := lower(coalesce(nullif(p_tipo,''),'preventivo'));
  if v_tipo not in ('preventivo','falla','accidente_dano','cambio_pieza','engrase',
                    'hidraulico','reparacion','tintado','bombillo','neumatico',
                    'bateria','lavado','otros') then
    v_tipo := 'otros';
  end if;

  -- CH2 — nombre del proveedor: el escrito, o el del maestro si vino proveedor_id.
  v_prov := nullif(p_proveedor,'');
  if v_prov is null and p_proveedor_id is not null then
    select nombre into v_prov from sgc.proveedores where id = p_proveedor_id;
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha,
    kilometraje_al_mantenimiento, estado, fotos, incluye_preventivo, accidente_id,
    costo, proveedor, proveedor_id, notas, creado_por)
  values (
    p_id, p_vehiculo_id, v_tipo, p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}'),
    coalesce(p_incluye_preventivo, false), p_accidente_id,
    p_costo, v_prov, p_proveedor_id, nullif(p_notas,''), v_uid
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);

  -- AL7: aviso al jefe de flota cuando lo registra un chofer (no elevado).
  if not v_elevado then
    select nombre into v_veh_nombre from sgc.vehiculos where id = p_vehiculo_id;
    select nombre into v_yo from sgc.usuarios where id = v_uid;
    for v_r in
      select distinct ur.usuario_id
        from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where r.codigo in (select unnest(sgc.param_csv('mantenimiento_aviso_roles','jefe_flota,logistica,admin')))
          and ur.usuario_id is distinct from v_uid
    loop
      perform sgc.notificar(v_r.usuario_id, 'flota',
        'Mantenimiento registrado por un chofer',
        format('%s registró un mantenimiento (%s) del vehículo %s.',
               coalesce(v_yo,'Un chofer'), v_tipo, coalesce(v_veh_nombre,'—')),
        '/flota/mantenimientos');
    end loop;
  end if;

  return p_id;
end;
$function$;
grant execute on function sgc.crear_mantenimiento_app(
  uuid, uuid, text, text, date, numeric, jsonb, timestamp with time zone,
  boolean, uuid, numeric, text, text, uuid
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
