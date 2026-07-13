-- ============================================================================
-- A6 — Checklists digitales de Flota (pre-uso e inspección) — reunión 07/07/2026
-- ----------------------------------------------------------------------------
-- Digitaliza los dos formularios físicos: "Pre-Uso Vehículos Livianos" y el
-- checklist de seguridad "Autorizado y Apto para la Tarea" (19 ítems), con
-- variantes por tipo (liviano / camión / equipo). Respuestas OK/NO/NA + fotos.
-- Ítem crítico en NO -> alerta OPERATIVA (no silenciosa) a Flota/Mantenimiento.
--
-- Diseñado para captura de campo desde la CSD App: RPC security definer,
-- idempotente por UUID de cliente, offline-friendly.
-- ============================================================================

set search_path = sgc, public;

-- 1) Plantillas de checklist (configurables) --------------------------------
create table if not exists sgc.checklist_plantillas (
  id          uuid primary key default gen_random_uuid(),
  codigo      text unique not null,
  nombre      text not null,
  -- 'liviano' | 'camion' | 'equipo' | 'general'
  categoria   text not null default 'general',
  descripcion text,
  activo      boolean not null default true,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists sgc.checklist_plantilla_items (
  id          uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references sgc.checklist_plantillas(id) on delete cascade,
  -- 'aptitud' (pre-uso) | 'seguridad' (inspección) | 'otro'
  seccion     text not null default 'seguridad',
  etiqueta    text not null,
  es_critico  boolean not null default false,
  orden       int not null default 0
);

-- 2) Checklists llenados (cabecera) ------------------------------------------
create table if not exists sgc.checklists_vehiculo (
  id            uuid primary key default gen_random_uuid(), -- UUID de cliente (idempotencia)
  plantilla_id  uuid references sgc.checklist_plantillas(id),
  vehiculo_id   uuid not null references sgc.vehiculos(id),
  conductor_id  uuid references sgc.conductores(id),
  -- 'pre_uso' | 'inspeccion'
  tipo          text not null default 'pre_uso',
  fecha         date not null default current_date,
  -- campos de encabezado específicos del formulario (hora, ficha, km, depto, próx. mant., firma)
  datos         jsonb not null default '{}'::jsonb,
  kilometraje   numeric,
  firma_path    text,
  observaciones text,
  -- true si algún ítem crítico quedó en 'no'
  tiene_criticos boolean not null default false,
  -- gestión de la alerta operativa
  atendido      boolean not null default false,
  atendido_por  uuid references sgc.usuarios(id),
  atendido_en   timestamptz,
  nota_atencion text,
  creado_por    uuid references sgc.usuarios(id),
  capturado_en  timestamptz,
  created_at    timestamptz not null default now(),
  constraint checklists_vehiculo_tipo_chk check (tipo in ('pre_uso','inspeccion')),
  constraint checklists_vehiculo_estado_alerta_chk check (
    (atendido = false) or (atendido = true and atendido_por is not null)
  )
);

create table if not exists sgc.checklist_vehiculo_respuestas (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references sgc.checklists_vehiculo(id) on delete cascade,
  -- snapshot de la etiqueta/criticidad para que el historial sobreviva ediciones de plantilla
  etiqueta      text not null,
  seccion       text,
  es_critico    boolean not null default false,
  -- 'ok' | 'no' | 'na'
  respuesta     text not null default 'na',
  comentario    text,
  orden         int not null default 0,
  constraint checklist_resp_valor_chk check (respuesta in ('ok','no','na'))
);

create table if not exists sgc.checklist_vehiculo_fotos (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references sgc.checklists_vehiculo(id) on delete cascade,
  storage_path  text not null,
  slot          text
);

create index if not exists idx_checklists_vehiculo_vehiculo on sgc.checklists_vehiculo(vehiculo_id);
create index if not exists idx_checklists_vehiculo_pend on sgc.checklists_vehiculo(atendido) where tiene_criticos = true;
create index if not exists idx_checklist_resp_checklist on sgc.checklist_vehiculo_respuestas(checklist_id);
create index if not exists idx_checklist_fotos_checklist on sgc.checklist_vehiculo_fotos(checklist_id);

-- 3) RLS ----------------------------------------------------------------------
alter table sgc.checklist_plantillas          enable row level security;
alter table sgc.checklist_plantilla_items     enable row level security;
alter table sgc.checklists_vehiculo           enable row level security;
alter table sgc.checklist_vehiculo_respuestas enable row level security;
alter table sgc.checklist_vehiculo_fotos      enable row level security;

-- Plantillas: lectura para flota/admin; escritura para flota/admin.
drop policy if exists chk_plant_sel on sgc.checklist_plantillas;
create policy chk_plant_sel on sgc.checklist_plantillas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
drop policy if exists chk_plant_all on sgc.checklist_plantillas;
create policy chk_plant_all on sgc.checklist_plantillas for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

drop policy if exists chk_plant_it_sel on sgc.checklist_plantilla_items;
create policy chk_plant_it_sel on sgc.checklist_plantilla_items for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));
drop policy if exists chk_plant_it_all on sgc.checklist_plantilla_items;
create policy chk_plant_it_all on sgc.checklist_plantilla_items for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

-- Checklists llenados: flota/admin ven todo; el capturista ve lo suyo; conductor
-- vinculado ve lo suyo. Escritura vía RPC (security definer).
drop policy if exists chk_veh_sel on sgc.checklists_vehiculo;
create policy chk_veh_sel on sgc.checklists_vehiculo for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('flota') or creado_por = auth.uid()
    or exists (select 1 from sgc.conductores c where c.id = conductor_id and c.usuario_id = auth.uid())
  );
-- La atención de la alerta (marcar atendido) la hace flota/admin.
drop policy if exists chk_veh_upd on sgc.checklists_vehiculo;
create policy chk_veh_upd on sgc.checklists_vehiculo for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

drop policy if exists chk_resp_sel on sgc.checklist_vehiculo_respuestas;
create policy chk_resp_sel on sgc.checklist_vehiculo_respuestas for select to authenticated
  using (exists (
    select 1 from sgc.checklists_vehiculo h where h.id = checklist_id and (
      sgc.is_admin() or sgc.tiene_modulo('flota') or h.creado_por = auth.uid()
      or exists (select 1 from sgc.conductores c where c.id = h.conductor_id and c.usuario_id = auth.uid())
    )
  ));

drop policy if exists chk_fotos_sel on sgc.checklist_vehiculo_fotos;
create policy chk_fotos_sel on sgc.checklist_vehiculo_fotos for select to authenticated
  using (exists (
    select 1 from sgc.checklists_vehiculo h where h.id = checklist_id and (
      sgc.is_admin() or sgc.tiene_modulo('flota') or h.creado_por = auth.uid()
      or exists (select 1 from sgc.conductores c where c.id = h.conductor_id and c.usuario_id = auth.uid())
    )
  ));

-- 4) Grants (schema custom no autoconcede) -----------------------------------
grant usage on schema sgc to authenticated;
grant select on sgc.checklist_plantillas, sgc.checklist_plantilla_items,
                sgc.checklists_vehiculo, sgc.checklist_vehiculo_respuestas,
                sgc.checklist_vehiculo_fotos to authenticated;
grant insert, update on sgc.checklist_plantillas, sgc.checklist_plantilla_items to authenticated;
grant update on sgc.checklists_vehiculo to authenticated;
grant all on sgc.checklist_plantillas, sgc.checklist_plantilla_items,
              sgc.checklists_vehiculo, sgc.checklist_vehiculo_respuestas,
              sgc.checklist_vehiculo_fotos to service_role;

-- 5) RPC de captura (web + app de campo) -------------------------------------
create or replace function sgc.registrar_checklist_vehiculo(
  p_id           uuid,
  p_plantilla_id uuid,
  p_vehiculo_id  uuid,
  p_conductor_id uuid,
  p_tipo         text,
  p_fecha        date,
  p_datos        jsonb,        -- encabezado libre {hora, ficha, departamento, proximo_mantenimiento, ...}
  p_kilometraje  numeric,
  p_respuestas   jsonb,        -- [{etiqueta, seccion, es_critico, respuesta, comentario, orden}]
  p_fotos        jsonb,        -- [{storage_path, slot}]
  p_firma_path   text,
  p_observaciones text,
  p_capturado_en timestamptz
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_criticos boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia: reenvío del mismo op devuelve el id existente.
  if exists (select 1 from sgc.checklists_vehiculo where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  select coalesce(bool_or((r->>'es_critico')::boolean and lower(r->>'respuesta') = 'no'), false)
    into v_criticos
    from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  insert into sgc.checklists_vehiculo (
    id, plantilla_id, vehiculo_id, conductor_id, tipo, fecha, datos, kilometraje,
    firma_path, observaciones, tiene_criticos, creado_por, capturado_en
  ) values (
    p_id, p_plantilla_id, p_vehiculo_id, p_conductor_id, coalesce(p_tipo,'pre_uso'),
    coalesce(p_fecha, current_date), coalesce(p_datos, '{}'::jsonb), p_kilometraje,
    p_firma_path, p_observaciones, v_criticos, v_uid, coalesce(p_capturado_en, now())
  );

  insert into sgc.checklist_vehiculo_respuestas (checklist_id, etiqueta, seccion, es_critico, respuesta, comentario, orden)
  select p_id, r->>'etiqueta', r->>'seccion',
         coalesce((r->>'es_critico')::boolean, false),
         coalesce(lower(r->>'respuesta'), 'na'),
         r->>'comentario',
         coalesce((r->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  insert into sgc.checklist_vehiculo_fotos (checklist_id, storage_path, slot)
  select p_id, f->>'storage_path', f->>'slot'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
  where nullif(f->>'storage_path','') is not null;

  return p_id;
end;
$$;

grant execute on function sgc.registrar_checklist_vehiculo(
  uuid, uuid, uuid, uuid, text, date, jsonb, numeric, jsonb, jsonb, text, text, timestamptz
) to authenticated, service_role;

-- Marcar alerta de checklist como atendida (flota/admin)
create or replace function sgc.atender_checklist_vehiculo(p_id uuid, p_nota text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No autorizado';
  end if;
  update sgc.checklists_vehiculo
     set atendido = true, atendido_por = auth.uid(), atendido_en = now(), nota_atencion = p_nota
   where id = p_id;
end;
$$;
grant execute on function sgc.atender_checklist_vehiculo(uuid, text) to authenticated, service_role;

-- 6) Realtime (alerta operativa en vivo a Flota) -----------------------------
do $$ begin
  alter publication supabase_realtime add table sgc.checklists_vehiculo;
exception when duplicate_object then null; end $$;
