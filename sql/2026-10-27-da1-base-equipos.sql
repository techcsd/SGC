-- ============================================================================
-- DA1 (PROMPT-122, ronda DA, 27-oct-2026) — Inventario tecnológico, FASE 1:
-- base. Tres arreglos de fondo antes de cualquier campo/kit/clave nuevos
-- (CONTEXTO-ACTUALIZACION-60.md §2, hallazgos 1-3):
--
--   (DA7/DA-04) El "estado" estaba clavado en un CHECK de 4 valores
--     (2026-07-12-tecnologia-module.sql:55) — no se podía agregar "averiado"/
--     "extraviado"/"en préstamo" sin tocar SQL + TypeScript de las dos apps.
--     Se convierte en catálogo administrable (mismo patrón que AL1 tipos),
--     y se separa SITUACIÓN (estado: dónde está/qué hace) de CONDICIÓN (cómo
--     está físicamente) — resuelve 5.2/7.3 ("en stock + averiado" a la vez).
--   (DA8) El historial (tec_equipo_historial) solo lo escribía el NAVEGADOR
--     (tecnologia.service.ts:255,288) — la app móvil y el conector de Claude
--     no podían dejar rastro. Pasa a trigger AFTER INSERT/UPDATE en el servidor.
--   (DA9) El código TEC-#### lo calculaba el navegador (tecnologia.service.ts:
--     238-242, MAX+1) — dos altas simultáneas (o una carga por lote/app) podían
--     duplicarlo. Pasa a secuencia + trigger BEFORE INSERT.
--
-- Aditivo, idempotente. Regla 18: dev primero.
-- Apply: node scripts/apply-migration.mjs sql/2026-10-27-da1-base-equipos.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Catálogos administrables: situación y condición ─────────────────────
create table if not exists sgc.tec_equipo_estados (
  id         uuid primary key default gen_random_uuid(),
  clave      text unique not null,
  label      text not null,
  orden      int not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sgc.tec_equipo_condiciones (
  id         uuid primary key default gen_random_uuid(),
  clave      text unique not null,
  label      text not null,
  orden      int not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed: las 4 que ya existían (mismas claves — sin migración de datos reales)
-- + las nuevas que pidió Xaviel (5.2): en_prestamo, extraviado.
insert into sgc.tec_equipo_estados (clave, label, orden) values
  ('activo',        'Asignado / en uso', 10),
  ('en_stock',       'En stock',          20),
  ('en_reparacion',  'En reparación',     30),
  ('en_prestamo',    'En préstamo',       40),
  ('extraviado',     'Extraviado',        50),
  ('dado_de_baja',   'Dado de baja',      60)
on conflict (clave) do nothing;

-- "Averiado" y "en reparación" son distintos (DA-04): uno es SITUACIÓN (dónde
-- está/qué hace), el otro es CONDICIÓN (cómo está físicamente). Un equipo en
-- stock puede estar averiado; uno en reparación, pendiente de diagnóstico.
insert into sgc.tec_equipo_condiciones (clave, label, orden) values
  ('funciona',        'Funciona',          10),
  ('averiado',        'Averiado',          20),
  ('por_diagnosticar','Por diagnosticar',  30)
on conflict (clave) do nothing;

alter table sgc.tec_equipo_estados     enable row level security;
alter table sgc.tec_equipo_condiciones enable row level security;

drop policy if exists tec_equipo_estados_sel on sgc.tec_equipo_estados;
create policy tec_equipo_estados_sel on sgc.tec_equipo_estados
  for select to authenticated using (true);
drop policy if exists tec_equipo_estados_ins on sgc.tec_equipo_estados;
create policy tec_equipo_estados_ins on sgc.tec_equipo_estados
  for insert to authenticated with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));
drop policy if exists tec_equipo_estados_upd on sgc.tec_equipo_estados;
create policy tec_equipo_estados_upd on sgc.tec_equipo_estados
  for update to authenticated using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));
grant select, insert, update on sgc.tec_equipo_estados to authenticated;
-- service_role también necesita SELECT (no es automático: BYPASSRLS exime de
-- RLS, no de GRANT — mismo gotcha real de tec_equipo_seq más abajo). Lo
-- necesita cualquier escritura por service_role que dispare el trigger de
-- validación o el de historial (ej. la edge equipos-clave, DA4, actualiza
-- tec_equipos.tiene_clave y esos triggers leen este catálogo).
grant select on sgc.tec_equipo_estados to service_role;

drop policy if exists tec_equipo_condiciones_sel on sgc.tec_equipo_condiciones;
create policy tec_equipo_condiciones_sel on sgc.tec_equipo_condiciones
  for select to authenticated using (true);
drop policy if exists tec_equipo_condiciones_ins on sgc.tec_equipo_condiciones;
create policy tec_equipo_condiciones_ins on sgc.tec_equipo_condiciones
  for insert to authenticated with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));
drop policy if exists tec_equipo_condiciones_upd on sgc.tec_equipo_condiciones;
create policy tec_equipo_condiciones_upd on sgc.tec_equipo_condiciones
  for update to authenticated using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));
grant select, insert, update on sgc.tec_equipo_condiciones to authenticated;
grant select on sgc.tec_equipo_condiciones to service_role;

-- ── (2) tec_equipos: quita el CHECK fijo, agrega condición ──────────────────
alter table sgc.tec_equipos drop constraint if exists tec_equipos_estado_chk;
alter table sgc.tec_equipos add column if not exists condicion text not null default 'funciona';
comment on column sgc.tec_equipos.estado is
  'DA7/DA-04 — SITUACIÓN (dónde está/qué hace). Validado por trigger contra el catálogo sgc.tec_equipo_estados (ya no CHECK fijo — admin/tecnología puede agregar valores sin tocar código).';
comment on column sgc.tec_equipos.condicion is
  'DA7/DA-04 — CONDICIÓN (cómo está físicamente), independiente de la situación: un equipo puede estar "en_stock" (situación) y "averiado" (condición) a la vez. Catálogo sgc.tec_equipo_condiciones.';

-- Validación por trigger (no CHECK): permite agregar valores al catálogo sin
-- recrear el constraint en cada migración (regla 3 del checklist: un CHECK fijo
-- obliga a tocar SQL cada vez que se agrega un estado — ya pasó con BG5).
create or replace function sgc.tg_tec_equipos_validar_catalogos()
returns trigger language plpgsql as $$
begin
  if new.estado is not null and not exists (
    select 1 from sgc.tec_equipo_estados where clave = new.estado and activo = true
  ) then
    perform sgc.error_campo('estado', 'valor_no_en_catalogo', 'Esa situación no existe o está desactivada.');
  end if;
  if new.condicion is not null and not exists (
    select 1 from sgc.tec_equipo_condiciones where clave = new.condicion and activo = true
  ) then
    perform sgc.error_campo('condicion', 'valor_no_en_catalogo', 'Esa condición no existe o está desactivada.');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tec_equipos_validar_catalogos on sgc.tec_equipos;
create trigger trg_tec_equipos_validar_catalogos
  before insert or update on sgc.tec_equipos
  for each row execute function sgc.tg_tec_equipos_validar_catalogos();

-- ── (3) Código TEC-#### en la base (DA9) ─────────────────────────────────────
-- Antes lo calculaba el navegador (MAX+1, condición de carrera real: dos altas
-- a la vez, o una por conector/lote, podían pedir el mismo número y una de las
-- dos fallaba por `codigo unique`). La secuencia es atómica.
create sequence if not exists sgc.tec_equipo_seq;
-- Gotcha recurrente (CLAUDE.md): una secuencia nueva no hereda acceso de
-- `authenticated` — sin este grant, el trigger revienta con "permission denied
-- for sequence tec_equipo_seq" en el primer INSERT hecho como ese rol.
grant usage, select on sequence sgc.tec_equipo_seq to authenticated, service_role;
select setval('sgc.tec_equipo_seq',
  greatest(1, coalesce((
    select max(substring(codigo from 'TEC-(\d+)$')::int)
    from sgc.tec_equipos
    where codigo ~ '^TEC-\d+$'
  ), 0)),
  true);

create or replace function sgc.tg_tec_equipos_asignar_codigo()
returns trigger language plpgsql as $$
begin
  if new.codigo is null then
    new.codigo := 'TEC-' || lpad(nextval('sgc.tec_equipo_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tec_equipos_asignar_codigo on sgc.tec_equipos;
create trigger trg_tec_equipos_asignar_codigo
  before insert on sgc.tec_equipos
  for each row execute function sgc.tg_tec_equipos_asignar_codigo();

-- ── (4) Historial por trigger, no por el cliente (DA8) ──────────────────────
-- Escritores de `tec_equipo_historial` ANTES de esta migración: únicamente
-- `tecnologia.service.ts` (web), en `createEquipo`/`updateEquipo` (regla 13 del
-- checklist — inventario de escritores). Esta migración AÑADE el trigger como
-- escritor y el frontend deja de llamar `addHistorial` en esos dos puntos (se
-- retira el método completo — ver tecnologia.service.ts — para no duplicar
-- filas ni dejar un export sin llamador, BJ3/regla 6.5). A partir de aquí el
-- único escritor es este trigger, válido para web, app y el conector de Claude.
create or replace function sgc.tg_tec_equipos_historial()
returns trigger language plpgsql as $$
declare
  v_cambios text[] := '{}';
  v_tipo text := 'edicion';
  v_usuario uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id, usuario_id)
    values (new.id, 'asignacion', format('Equipo registrado (situación: %s).', coalesce(new.estado, '—')), new.empleado_id, v_usuario);
    return new;
  end if;

  -- UPDATE: solo registra lo que de verdad cambió (regla DA8 — "ignora
  -- actualizaciones silenciosas", mismo criterio que ya aplicaba el código del
  -- navegador para foto_path).
  if new.estado is distinct from old.estado then
    v_cambios := v_cambios || format('Situación: %s → %s.',
      coalesce((select label from sgc.tec_equipo_estados where clave = old.estado), old.estado, '—'),
      coalesce((select label from sgc.tec_equipo_estados where clave = new.estado), new.estado, '—'));
    v_tipo := 'estado';
  end if;
  if new.condicion is distinct from old.condicion then
    v_cambios := v_cambios || format('Condición: %s → %s.',
      coalesce((select label from sgc.tec_equipo_condiciones where clave = old.condicion), old.condicion, '—'),
      coalesce((select label from sgc.tec_equipo_condiciones where clave = new.condicion), new.condicion, '—'));
    if v_tipo = 'edicion' then v_tipo := 'estado'; end if;
  end if;
  if new.empleado_id is distinct from old.empleado_id then
    v_cambios := v_cambios || (case when new.empleado_id is null then 'Desasignado (sin empleado).' else 'Reasignado a un empleado.' end)::text;
    v_tipo := 'asignacion';
  end if;
  if new.bodega_id is distinct from old.bodega_id or new.ubicacion is distinct from old.ubicacion then
    v_cambios := v_cambios || 'Cambió de ubicación/bodega.'::text;
    if v_tipo = 'edicion' then v_tipo := 'ubicacion'; end if;
  end if;
  if new.costo is distinct from old.costo then
    v_cambios := v_cambios || format('Costo: %s → %s.', coalesce(old.costo::text, '—'), coalesce(new.costo::text, '—'));
  end if;
  if new.activo is distinct from old.activo and new.activo = false then
    v_cambios := v_cambios || 'Dado de baja.'::text;
    v_tipo := 'baja';
  end if;

  if array_length(v_cambios, 1) > 0 then
    insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id, usuario_id)
    values (new.id, v_tipo, array_to_string(v_cambios, ' '),
            coalesce(new.empleado_id, old.empleado_id), v_usuario);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tec_equipos_historial on sgc.tec_equipos;
create trigger trg_tec_equipos_historial
  after insert or update on sgc.tec_equipos
  for each row execute function sgc.tg_tec_equipos_historial();

-- El historial es de solo-insertar desde ahora en adelante (ni siquiera el
-- trigger necesita editar/borrar); `authenticated` nunca tuvo delete real de
-- uso (UI no lo expone), pero el grant original (2026-07-12) daba
-- select/insert/update/delete de tabla completa — se recorta a lo que de
-- verdad se usa, append-only como `boveda_accesos` (mismo patrón CZ3/CZ9).
revoke insert, update, delete on sgc.tec_equipo_historial from authenticated;
grant select, insert on sgc.tec_equipo_historial to authenticated;

commit;
