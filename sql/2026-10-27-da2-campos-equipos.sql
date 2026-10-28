-- ============================================================================
-- DA2 (PROMPT-122, ronda DA, 27-oct-2026) — Inventario tecnológico, FASE 2:
-- campos que hoy solo cabían en "notas" (CONTEXTO-ACTUALIZACION-60.md §1,
-- notas A-E) + datos de dueño/costo/garantía (§7).
--
--   DA-02 — Identificación (service tag, parte, año, código anterior, IMEI,
--     taller) como columnas de tec_equipos; especificaciones (computadora,
--     radio, batería, accesorios, dron) en tabla 1:1 tec_equipo_specs.
--   DA-03 — tec_equipo_tipos.grupos_campos decide qué bloque de specs se
--     muestra según el tipo (laptop/desktop → computadora; walkie_talkie/
--     radio_base → radio; drone → dron; todos con batería salvo accesorio/otro).
--   DA-07 — usuario_windows/nombre_windows viven en specs, separados de
--     empleado_id (el dueño real puede no coincidir con la sesión de Windows).
--   DA-11 — responsable_externo (persona sin usuario en el SGC, ej. Cristofer).
--   DA-12 — costo_origen (compra|estimado|donado) + fecha_compra_desconocida/
--     garantia_desconocida explícitas (vacío ya NO es lo mismo que "no se sabe").
--   DA-14 — fotos_specs (captura de "Información del sistema" de Windows,
--     separada de la galería de portada).
--
-- Aditivo, idempotente. Regla 18: dev primero.
-- Apply: node scripts/apply-migration.mjs sql/2026-10-27-da2-campos-equipos.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Identificación — columnas directas en tec_equipos ───────────────────
alter table sgc.tec_equipos
  add column if not exists service_tag        text,
  add column if not exists codigo_servicio     text,
  add column if not exists numero_parte        text,
  add column if not exists modelo_regulatorio  text,
  add column if not exists anio_fabricacion    int,
  add column if not exists codigo_anterior     text,
  add column if not exists imei                text,
  add column if not exists etiqueta_taller     text;

comment on column sgc.tec_equipos.service_tag       is 'DA2/DA-02 — Service Tag (Dell) / Plan ID-Unit ID (Lenovo) / Express Service Code.';
comment on column sgc.tec_equipos.codigo_anterior   is 'DA2/DA-02 — etiqueta de activo puesta por alguien antes de este inventario (ej. 001-1843267-3).';
comment on column sgc.tec_equipos.etiqueta_taller   is 'DA2/DA-02 — número de orden de un taller/servicio técnico externo.';

-- ── (2) DA-11 — responsable sin usuario en el SGC ───────────────────────────
alter table sgc.tec_equipos add column if not exists responsable_externo text;
comment on column sgc.tec_equipos.responsable_externo is
  'DA-11 — persona que usa el equipo pero no tiene usuario/empleado en el SGC (ej. Cristofer, Contabilidad). No reemplaza empleado_id; son complementarios — la UI muestra ambos.';

-- ── (3) DA-12 — costo: origen + "desconocida" explícita ─────────────────────
alter table sgc.tec_equipos add column if not exists costo_origen text not null default 'compra';
alter table sgc.tec_equipos drop constraint if exists tec_equipos_costo_origen_chk;
alter table sgc.tec_equipos add constraint tec_equipos_costo_origen_chk
  check (costo_origen in ('compra','estimado','donado'));
-- Backfill (regla BF1 — toda columna NOT NULL nace con default O backfill; aquí
-- ambos: default 'compra' + este UPDATE no-op porque la columna ya nació con
-- ese default para las filas existentes, se deja explícito por claridad).
update sgc.tec_equipos set costo_origen = 'compra' where costo_origen is null;

alter table sgc.tec_equipos
  add column if not exists fecha_compra_desconocida boolean not null default false,
  add column if not exists garantia_desconocida     boolean not null default false;
comment on column sgc.tec_equipos.costo_origen is
  'DA-12 — compra (precio real pagado) | estimado (precio referencial de mercado, sin factura) | donado. Los reportes de activos separan estimado de real.';
comment on column sgc.tec_equipos.fecha_compra_desconocida is 'DA-12 — explícito: "no se sabe", distinto de vacío (nunca capturado).';
comment on column sgc.tec_equipos.garantia_desconocida     is 'DA-12 — explícito: "no se sabe", distinto de vacío.';

-- ── (4) DA-14 — foto "especificaciones" (captura de Windows), separada de la
--     galería de portada (fotos[]/foto_portada, AL1) ───────────────────────
alter table sgc.tec_equipos add column if not exists fotos_specs text[] not null default '{}';
comment on column sgc.tec_equipos.fotos_specs is
  'DA-14 — capturas de "Información del sistema"/"Acerca de" de Windows u otra evidencia de specs. NO compite con fotos[]/foto_portada (esas son la portada del equipo).';

-- ── (5) tec_equipo_specs — 1:1, specs tipadas por familia ───────────────────
create table if not exists sgc.tec_equipo_specs (
  equipo_id          uuid primary key references sgc.tec_equipos(id) on delete cascade,
  -- Computadora (laptop/desktop)
  procesador         text,
  ram_gb             int,
  ram_velocidad      text,
  almacenamiento_tipo text, -- SSD | HDD | NVMe
  almacenamiento_gb  int,
  gpu_integrada      text,
  gpu_dedicada       text,
  gpu_memoria_gb      int,
  so                 text,
  so_version         text,
  pantalla_pulgadas  numeric,
  resolucion         text,
  tactil             boolean,
  nombre_windows     text,
  usuario_windows    text,
  cargador_voltaje   text,
  cargador_amperaje  text,
  -- Radio (walkie-talkie / radio base)
  frecuencia             text,
  potencia_w             numeric,
  tipo_radio             text, -- frecuencia | celular_ptt
  sello_telserdom_radio  text,
  sello_telserdom_bateria text,
  -- Batería (cualquier familia con batería propia)
  bateria_modelo     text,
  bateria_capacidad  numeric,
  bateria_unidad     text, -- mAh | Wh
  bateria_voltaje    text,
  bateria_sello      text,
  -- Accesorios (cualquier familia) + dron
  accesorios         text[] not null default '{}',
  camara_specs       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table sgc.tec_equipo_specs drop constraint if exists tec_equipo_specs_almacenamiento_tipo_chk;
alter table sgc.tec_equipo_specs add constraint tec_equipo_specs_almacenamiento_tipo_chk
  check (almacenamiento_tipo is null or almacenamiento_tipo in ('SSD','HDD','NVMe'));
alter table sgc.tec_equipo_specs drop constraint if exists tec_equipo_specs_bateria_unidad_chk;
alter table sgc.tec_equipo_specs add constraint tec_equipo_specs_bateria_unidad_chk
  check (bateria_unidad is null or bateria_unidad in ('mAh','Wh'));
alter table sgc.tec_equipo_specs drop constraint if exists tec_equipo_specs_tipo_radio_chk;
alter table sgc.tec_equipo_specs add constraint tec_equipo_specs_tipo_radio_chk
  check (tipo_radio is null or tipo_radio in ('frecuencia','celular_ptt'));

comment on table sgc.tec_equipo_specs is
  'DA2/DA-02 — especificaciones técnicas 1:1 con tec_equipos. Qué bloque se muestra lo decide tec_equipo_tipos.grupos_campos (DA-03), pero cualquier columna se puede guardar sin importar el tipo (sin CHECK cruzado).';

alter table sgc.tec_equipo_specs enable row level security;
drop policy if exists tec_equipo_specs_all on sgc.tec_equipo_specs;
create policy tec_equipo_specs_all on sgc.tec_equipo_specs for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_ver_submodulo('tecnologia.inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));
grant select, insert, update, delete on sgc.tec_equipo_specs to authenticated;

create or replace function sgc.tg_tec_equipo_specs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_tec_equipo_specs_updated_at on sgc.tec_equipo_specs;
create trigger trg_tec_equipo_specs_updated_at
  before update on sgc.tec_equipo_specs
  for each row execute function sgc.tg_tec_equipo_specs_updated_at();

-- ── (6) DA-03 — qué bloque de specs ofrece cada tipo ────────────────────────
alter table sgc.tec_equipo_tipos add column if not exists grupos_campos text[] not null default '{}';
comment on column sgc.tec_equipo_tipos.grupos_campos is
  'DA-03 — qué bloques de tec_equipo_specs mostrar en el formulario/ficha para este tipo: computadora | radio | bateria | dron. Administrable junto con el tipo (sin tocar código al agregar uno).';

update sgc.tec_equipo_tipos set grupos_campos = array['computadora','bateria']
 where clave in ('laptop','desktop') and grupos_campos = '{}';
update sgc.tec_equipo_tipos set grupos_campos = array['radio','bateria']
 where clave in ('walkie_talkie','radio_base') and grupos_campos = '{}';
update sgc.tec_equipo_tipos set grupos_campos = array['dron','bateria']
 where clave = 'drone' and grupos_campos = '{}';
update sgc.tec_equipo_tipos set grupos_campos = array['bateria']
 where clave in ('telefono','tablet','camara','gps') and grupos_campos = '{}';
-- El resto (monitor, impresora, router, ups, proyector, nivel_laser, accesorio,
-- otro) se queda con '{}' — solo identificación + accesorios, sin bloque técnico.

-- ── (7) Historial — añade responsable_externo a lo que ya cubría DA-08 ─────
-- (F1 cubría estado, condición, empleado_id, bodega/ubicación, costo, baja.
--  Escritores de tec_equipo_historial: únicamente este trigger desde DA1.)
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
  if new.responsable_externo is distinct from old.responsable_externo then
    v_cambios := v_cambios || (case when new.responsable_externo is null then 'Sin responsable externo.' else format('Responsable externo: %s.', new.responsable_externo) end)::text;
    if v_tipo = 'edicion' then v_tipo := 'asignacion'; end if;
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
-- (el trigger ya existe desde DA1; create or replace de la función basta, no
-- hace falta recrear el trigger en sí)

commit;
