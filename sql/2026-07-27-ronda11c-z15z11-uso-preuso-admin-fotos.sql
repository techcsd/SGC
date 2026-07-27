-- ============================================================================
-- RONDA 11c · Z15 + Z11 — Uso del vehículo, pre-uso administrativo y fotos del
--                          semanal con etiquetas explícitas por zona.
-- ----------------------------------------------------------------------------
-- Z15 — `vehiculos.uso` (obra | administrativo, default obra). El pre-uso servido
--        depende del uso: obra → pre-uso completo (PRE-USO-V4); administrativo →
--        variante reducida (PRE-USO-ADMIN-V1: solo lo esencial). Se añade
--        `checklist_plantillas.uso_aplica` (obra|administrativo|ambos) y un RPC
--        que sirve la plantilla vigente según el vehículo.
-- Z11 — Catálogo de slots de foto del semanal con etiquetas explícitas por zona,
--        agrupadas por sección, para que la app las pinte (tabla checklist_foto_slots,
--        6 slots: 4 exterior + 2 interior). Retrocompatible: los reportes viejos
--        (con slots viejos) se siguen viendo por su snapshot de path/slot.
-- Aditivo, idempotente. Los seeds anteriores quedan intactos.
-- ============================================================================

set search_path = sgc, public;

-- ── Z15.1 — columna `uso` en vehículos ─────────────────────────────────────
alter table sgc.vehiculos
  add column if not exists uso text not null default 'obra';
do $$ begin
  alter table sgc.vehiculos add constraint vehiculos_uso_chk check (uso in ('obra','administrativo'));
exception when duplicate_object then null; end $$;

-- ── Z15.2 — columna `uso_aplica` en plantillas de checklist ─────────────────
alter table sgc.checklist_plantillas
  add column if not exists uso_aplica text not null default 'ambos';
do $$ begin
  alter table sgc.checklist_plantillas add constraint checklist_plantillas_uso_aplica_chk
    check (uso_aplica in ('obra','administrativo','ambos'));
exception when duplicate_object then null; end $$;

-- ── Z15.3 — variante de pre-uso ADMINISTRATIVO (reducida) ───────────────────
-- Solo lo esencial: exterior, luces, gomas, frenos. El km y el nivel de
-- combustible (con "E") se capturan en el encabezado del checklist, no como ítems.
do $$
declare v_pid uuid;
begin
  insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia, uso_aplica)
  values ('PRE-USO-ADMIN-V1', 'Pre-uso vehículo administrativo', 'general',
          'Pre-uso reducido para vehículos administrativos: exterior, luces, gomas, frenos + km y combustible en el encabezado.',
          true, 2, 'preuso', 'administrativo')
  on conflict (codigo) do update set activo = true, nombre = excluded.nombre,
    categoria = excluded.categoria, descripcion = excluded.descripcion,
    orden = excluded.orden, frecuencia = excluded.frecuencia, uso_aplica = excluded.uso_aplica;
  select id into v_pid from sgc.checklist_plantillas where codigo = 'PRE-USO-ADMIN-V1';
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;
  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, ayuda, es_critico, aplica_a, orden) values
    (v_pid,'Exterior','1','Carro sin daños ni piezas sueltas',
       'Míralo por fuera: golpes, rayones o algo suelto antes de salir.', false,'Ambos',1),
    (v_pid,'Luces','2','Luces: delanteras, traseras, direccionales, freno',
       'Que todas enciendan: delanteras, traseras, direccionales y freno.', true,'Ambos',2),
    (v_pid,'Gomas','3','Gomas en buen estado · repuesto listo',
       'Aire, desgaste y sin cortes. La goma de repuesto también.', true,'Ambos',3),
    (v_pid,'Frenos','4','Frenos: que respondan bien',
       'Prueba el freno de pie y el de mano antes de arrancar.', true,'Ambos',4);
end $$;

-- PRE-USO-V4 (completo) sirve a obra y como fallback → uso_aplica se queda en 'ambos'
-- (default). No se toca para no romper el flujo actual.

-- ── Z11 — catálogo de slots de foto por frecuencia, agrupado por sección ────
create table if not exists sgc.checklist_foto_slots (
  id         uuid primary key default gen_random_uuid(),
  frecuencia text not null,                 -- 'semanal' | 'preuso'
  seccion    text not null,                 -- 'Exterior' | 'Interior' | ...
  slot       text not null,                 -- clave estable (guardada en checklist_vehiculo_fotos.slot)
  etiqueta   text not null,                 -- texto explícito por zona
  orden      int  not null default 0,
  activo     boolean not null default true,
  unique (frecuencia, slot)
);

alter table sgc.checklist_foto_slots enable row level security;
drop policy if exists chk_foto_slots_sel on sgc.checklist_foto_slots;
create policy chk_foto_slots_sel on sgc.checklist_foto_slots for select to authenticated
  using (true);  -- catálogo público a autenticados (solo etiquetas, sin datos sensibles)
drop policy if exists chk_foto_slots_all on sgc.checklist_foto_slots;
create policy chk_foto_slots_all on sgc.checklist_foto_slots for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

grant usage on schema sgc to authenticated;
grant select on sgc.checklist_foto_slots to authenticated;
grant all on sgc.checklist_foto_slots to service_role;

-- Semanal — 6 slots (4 exterior + 2 interior), etiquetas explícitas por zona.
delete from sgc.checklist_foto_slots where frecuencia = 'semanal';
insert into sgc.checklist_foto_slots (frecuencia, seccion, slot, etiqueta, orden) values
  ('semanal','Exterior','ext_delantera','Exterior — vista delantera',1),
  ('semanal','Exterior','ext_trasera','Exterior — vista trasera',2),
  ('semanal','Exterior','ext_lateral_izq','Exterior — lateral izquierdo',3),
  ('semanal','Exterior','ext_lateral_der','Exterior — lateral derecho',4),
  ('semanal','Interior','int_asientos_del','Interior — asientos delanteros',5),
  ('semanal','Interior','int_asientos_tras','Interior — asientos traseros / baúl',6);

-- Pre-uso — set explícito equivalente al histórico (para paridad del catálogo).
delete from sgc.checklist_foto_slots where frecuencia = 'preuso';
insert into sgc.checklist_foto_slots (frecuencia, seccion, slot, etiqueta, orden) values
  ('preuso','Exterior','delantera','Exterior — vista delantera',1),
  ('preuso','Exterior','lateral_izq','Exterior — lateral izquierdo',2),
  ('preuso','Exterior','lateral_der','Exterior — lateral derecho',3),
  ('preuso','Exterior','trasera','Exterior — vista trasera',4),
  ('preuso','Interior','tablero','Interior — tablero / odómetro',5),
  ('preuso','Interior','interior_del','Interior — asientos delanteros',6),
  ('preuso','Interior','parte_trasera','Interior — asientos traseros / baúl',7);

-- ── Z15.4 — RPC: plantilla de checklist vigente según el vehículo (app contract) ──
-- Devuelve la plantilla + ítems (filtrados por clase del vehículo) + slots de foto.
-- Para pre-uso: si el vehículo es administrativo y hay variante 'administrativo'
-- activa, la sirve; si no, cae a la 'obra'/'ambos'. Para semanal: la semanal activa.
create or replace function sgc.checklist_plantilla_vigente(p_vehiculo_id uuid, p_frecuencia text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uso    text;
  v_tipo   text;
  v_clase  text;
  v_pid    uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;

  select coalesce(uso,'obra'), tipo into v_uso, v_tipo
    from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado'; end if;

  -- Clase liviano/pesado (mismo criterio que el front): livianos = moto/auto/suv/pickup/otro.
  v_clase := case when v_tipo in ('motocicleta','automovil','suv','pickup','otro') then 'Liviano' else 'Pesado' end;

  if p_frecuencia = 'semanal' then
    select id into v_pid from sgc.checklist_plantillas
      where activo and frecuencia = 'semanal'
      order by orden limit 1;
  else
    -- Pre-uso: prioriza la variante exacta por uso; luego 'ambos'; luego cualquiera.
    select id into v_pid from sgc.checklist_plantillas
      where activo and frecuencia = 'preuso'
        and uso_aplica in (v_uso, 'ambos')
      order by (uso_aplica = v_uso) desc, orden
      limit 1;
  end if;

  if v_pid is null then return null; end if;

  select jsonb_build_object(
    'plantilla', (select to_jsonb(p) from sgc.checklist_plantillas p where p.id = v_pid),
    'items', (
      select coalesce(jsonb_agg(to_jsonb(i) order by i.orden), '[]'::jsonb)
      from sgc.checklist_plantilla_items i
      where i.plantilla_id = v_pid
        and (i.aplica_a = 'Ambos' or i.aplica_a = v_clase)
    ),
    'foto_slots', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slot', s.slot, 'seccion', s.seccion, 'etiqueta', s.etiqueta, 'orden', s.orden) order by s.orden), '[]'::jsonb)
      from sgc.checklist_foto_slots s
      where s.frecuencia = coalesce(nullif(p_frecuencia,''),'preuso') and s.activo
    ),
    'uso', v_uso,
    'clase', v_clase
  ) into v_result;

  return v_result;
end;
$function$;
grant execute on function sgc.checklist_plantilla_vigente(uuid, text) to authenticated, service_role;
