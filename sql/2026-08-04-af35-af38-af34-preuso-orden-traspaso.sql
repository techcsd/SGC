-- ============================================================================
-- AF35 / AF38 / AF34 — Pre-uso sin combustible + orden de módulos + traspaso
-- Ronda 03/08/2026 (IDs AF) — PROMPT-1 FASE 7
-- ============================================================================

set search_path = sgc, public;

-- ── AF35 — Quitar la pregunta 5 (nivel de combustible) del pre-uso ───────────
-- PRE-USO-V5 pasa de 6 a 5 ítems (Gomas, Luces, Carrocería, Interior, Fugas).
-- Los pre-usos históricos guardan snapshot de sus etiquetas (igual que en AE8),
-- así que se siguen viendo bien; sólo cambian los NUEVOS pre-usos.
do $$
declare v_pid uuid;
begin
  select id into v_pid from sgc.checklist_plantillas where codigo = 'PRE-USO-V5';
  if v_pid is null then return; end if;
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;
  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, ayuda, es_critico, aplica_a, orden) values
    (v_pid,'Gomas','1','Gomas infladas y sin cortes a la vista',
       'Solo míralas: que no estén bajas ni con cortes/roturas. El desgaste y el repuesto los revisa el asignado en su reporte semanal.', true,'Ambos',1),
    (v_pid,'Luces','2','Luces encienden: frente, atrás y freno',
       'Enciéndelas y confirma que prenden delante, detrás y el freno. Nada más.', true,'Ambos',2),
    (v_pid,'Carrocería','3','Sin golpes ni daños nuevos por fuera',
       'Dale una vuelta rápida: ¿algún golpe, rayón o pieza suelta nueva? Tómale foto.', false,'Ambos',3),
    (v_pid,'Interior','4','Interior limpio y sin objetos sueltos',
       'Que esté limpio y sin cosas rodando. Tómale foto al interior.', false,'Ambos',4),
    (v_pid,'Fugas','5','Sin manchas de aceite o agua debajo',
       'Mira el piso donde estaba parqueado: ¿hay manchas frescas de aceite, agua o combustible?', true,'Ambos',5);
end $$;

-- ── AF38 — Orden de módulos/submódulos de la app (global, v1) ───────────────
create table if not exists sgc.app_module_order (
  clave      text primary key,          -- module/submodule key
  parent     text,                      -- null = top-level; si no, la clave del padre
  orden      int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references sgc.usuarios(id)
);

alter table sgc.app_module_order enable row level security;
drop policy if exists "app_module_order: read" on sgc.app_module_order;
create policy "app_module_order: read" on sgc.app_module_order
  for select to authenticated using (true);   -- todos leen el orden configurado
grant select on sgc.app_module_order to authenticated;
grant all on sgc.app_module_order to service_role;

create or replace function sgc.get_module_order()
returns setof sgc.app_module_order
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$ select * from sgc.app_module_order order by parent nulls first, orden; $$;
grant execute on function sgc.get_module_order() to authenticated, service_role;

-- Escritura sólo admin. p_items: [{clave, parent, orden}]
create or replace function sgc.set_module_order(p_items jsonb)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid(); it jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.is_admin() then raise exception 'Sólo un administrador puede reordenar módulos'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into sgc.app_module_order (clave, parent, orden, updated_at, updated_by)
    values (it->>'clave', nullif(it->>'parent',''), coalesce((it->>'orden')::int, 0), now(), v_uid)
    on conflict (clave) do update
      set parent = excluded.parent, orden = excluded.orden, updated_at = now(), updated_by = v_uid;
  end loop;
end;
$$;
grant execute on function sgc.set_module_order(jsonb) to authenticated, service_role;

-- ── AF34 — Traspaso de vehículo (backend) ───────────────────────────────────
-- Acta de entrega/recepción del vehículo entre el asignado anterior (A) y el
-- nuevo (B = quien se lo asigna). El pre-uso/fotos/km vienen del flujo de la app.
create table if not exists sgc.vehiculo_traspaso_actas (
  id             uuid primary key default gen_random_uuid(),
  vehiculo_id    uuid not null references sgc.vehiculos(id) on delete cascade,
  de_usuario_id  uuid references sgc.usuarios(id),   -- A (anterior)
  a_usuario_id   uuid not null references sgc.usuarios(id),   -- B (nuevo)
  km             int,
  condiciones    jsonb,     -- checklist/pre-uso de la app
  fotos          text[] not null default '{}',
  llave1_ubicacion_tipo text,
  notas          text,
  es_prueba      boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists idx_veh_traspaso_actas_veh on sgc.vehiculo_traspaso_actas (vehiculo_id, created_at desc);

alter table sgc.vehiculo_traspaso_actas enable row level security;
drop policy if exists "veh_traspaso_actas: read" on sgc.vehiculo_traspaso_actas;
create policy "veh_traspaso_actas: read" on sgc.vehiculo_traspaso_actas
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota') or de_usuario_id = auth.uid() or a_usuario_id = auth.uid());
grant select on sgc.vehiculo_traspaso_actas to authenticated;
grant all on sgc.vehiculo_traspaso_actas to service_role;

create or replace function sgc.traspasar_vehiculo(
  p_vehiculo_id      uuid,
  p_km               int    default null,
  p_condiciones      jsonb  default null,
  p_fotos            text[] default '{}',
  p_llave1_ubicacion text   default null,   -- 'chofer_asignado' | 'oficina_central' | 'otro'
  p_llave1_portador  uuid   default null,
  p_llave1_detalle   text   default null,
  p_notas            text   default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();   -- B (nuevo asignado)
  v_a   uuid;                 -- A (asignado anterior)
  v_placa text;
  v_es_prueba boolean := false;
  v_acta uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para recibir vehículos';
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id) then
    raise exception 'Vehículo no encontrado';
  end if;

  select placa, coalesce(es_prueba,false) into v_placa, v_es_prueba from sgc.vehiculos where id = p_vehiculo_id;

  -- Asignado anterior (A): asignación activa o responsable legacy.
  select coalesce(a.usuario_id, c.usuario_id)
    into v_a
    from sgc.vehiculo_asignaciones a
    left join sgc.conductores c on c.id = a.conductor_id
   where a.vehiculo_id = p_vehiculo_id and a.activa
   order by a.desde desc nulls last
   limit 1;
  if v_a is null then
    select responsable_id into v_a from sgc.vehiculos where id = p_vehiculo_id;
  end if;

  -- Reasignar: retira las asignaciones activas y crea la de B.
  update sgc.vehiculo_asignaciones set activa = false, hasta = now()
   where vehiculo_id = p_vehiculo_id and activa;
  insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, desde, activa, origen, notas)
  values (p_vehiculo_id, v_uid, now(), true, 'auto', p_notas);
  update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;

  if p_km is not null then perform sgc.avanzar_odometro(p_vehiculo_id, p_km); end if;

  -- Llave 1: registrar su disposición si se indicó (traspaso autorizado).
  if p_llave1_ubicacion in ('chofer_asignado','oficina_central','otro') then
    insert into sgc.vehiculo_llaves (vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, actualizado_por, updated_at)
    values (p_vehiculo_id, 1, p_llave1_ubicacion,
            case when p_llave1_ubicacion='chofer_asignado' then coalesce(p_llave1_portador, v_uid) else null end,
            case when p_llave1_ubicacion='otro' then p_llave1_detalle else null end, v_uid, now())
    on conflict (vehiculo_id, numero) do update
      set ubicacion_tipo = excluded.ubicacion_tipo, portador_usuario_id = excluded.portador_usuario_id,
          ubicacion_detalle = excluded.ubicacion_detalle, actualizado_por = v_uid, updated_at = now();
    insert into sgc.vehiculo_llave_traspasos (vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, nota, registrado_por)
    values (p_vehiculo_id, 1, p_llave1_ubicacion,
            case when p_llave1_ubicacion='chofer_asignado' then coalesce(p_llave1_portador, v_uid) else null end,
            case when p_llave1_ubicacion='otro' then p_llave1_detalle else null end, 'Traspaso de vehículo', v_uid);
  end if;

  -- Acta.
  insert into sgc.vehiculo_traspaso_actas (
    vehiculo_id, de_usuario_id, a_usuario_id, km, condiciones, fotos, llave1_ubicacion_tipo, notas, es_prueba
  ) values (
    p_vehiculo_id, v_a, v_uid, p_km, p_condiciones, coalesce(p_fotos,'{}'), p_llave1_ubicacion, p_notas, v_es_prueba
  ) returning id into v_acta;

  -- Notificar a A (in-app + push). A NO tiene que aceptar; sólo se le avisa.
  if v_a is not null and v_a <> v_uid then
    perform sgc.notificar(
      v_a, 'info', 'Te recibieron un vehículo',
      format('%s recibió el vehículo %s. La responsabilidad pasó a esa persona.',
             coalesce((select nombre from sgc.usuarios where id = v_uid), 'Otro usuario'),
             coalesce(v_placa, '')),
      '/flota/vehiculos/' || p_vehiculo_id::text
    );
  end if;

  return v_acta;
end;
$$;
grant execute on function sgc.traspasar_vehiculo(uuid, int, jsonb, text[], text, uuid, text, text) to authenticated, service_role;
