-- ════════════════════════════════════════════════════════════════════════════
-- BB (PROMPT-19 FASE 2) — Confiabilidad de Compa: idempotencia de acciones +
-- herramienta `proponer_ruta` (asignar una ruta de Flota como borrador+confirmación).
-- Ronda 19-29/08/2026. Aditivo, idempotente, retrocompatible.
--
-- Contexto:
--  • BB3: re-confirmar/re-proponer el mismo movimiento creaba DOS conduces. El edge
--    genera `p_id` fresco en cada confirmación → la idempotencia de la RPC
--    (crear_conduce_transportista devuelve el id si ya existe) no se activaba. Esta
--    tabla es la clave de idempotencia de nivel-intención: una acción confirmada dos
--    veces (misma clave determinística) produce UN documento.
--  • BB3(d): "asígnaselo a Papo" — Compa no tenía forma de crear la ruta de Flota.
--    `asistente_crear_ruta` la crea como borrador (estado 'planificada'), coordinada
--    con Transporte v3 (puede vincular un conduce existente).
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

-- ── 1) Idempotencia de acciones del asistente ─────────────────────────────────
-- clave = hash determinístico de (tipo de acción + parámetros normalizados), armado
-- en el edge. La PK evita la doble ejecución incluso ante confirmaciones concurrentes.
create table if not exists sgc.assistant_idempotencia (
  clave           text primary key,
  usuario_id      uuid not null default auth.uid() references sgc.usuarios(id),
  conversacion_id uuid,
  tool            text,
  estado          text not null default 'ejecutando' check (estado in ('ejecutando','hecho','error')),
  resultado       jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table sgc.assistant_idempotencia is
  'BB3 — clave de idempotencia por intención de acción de Compa. Evita conduces/tareas/requisiciones duplicados al confirmar dos veces.';

alter table sgc.assistant_idempotencia enable row level security;
-- Cada usuario solo ve/gestiona sus propias claves (defensa; el edge usa el JWT del usuario).
do $$ begin
  create policy assistant_idem_own on sgc.assistant_idempotencia
    for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
exception when duplicate_object then null; end $$;
grant select, insert, update on sgc.assistant_idempotencia to authenticated, service_role;

-- ── 2) quien_soy: identidad EN VIVO (re-verificación por request) ──────────────
-- Reutiliza capacidades_asistente (ya deriva la identidad del JWT) y le suma la
-- fecha/hora actual en zona RD, para que Compa pueda re-confirmar con quién habla
-- y qué día es, en el propio turno (research BB4 punto 5).
create or replace function sgc.quien_soy()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(sgc.capacidades_asistente(), '{}'::jsonb)
       || jsonb_build_object(
            'ahora_rd', to_char((now() at time zone 'America/Santo_Domingo'), 'YYYY-MM-DD HH24:MI'),
            'zona', 'America/Santo_Domingo'
          );
$$;
grant execute on function sgc.quien_soy() to authenticated, service_role;

-- ── 3) asistente_crear_ruta: `proponer_ruta` (borrador de ruta de Flota) ───────
-- Crea una ruta 'planificada' para un chofer (resuelto por usuario_id → conductores),
-- opcionalmente vinculada a un conduce existente (Transporte v3). Idempotente por p_id.
-- Permiso: referente de logística, o quien puede crear conduces, o admin.
create or replace function sgc.asistente_crear_ruta(
  p_id                     uuid,
  p_conductor_usuario_id   uuid,
  p_vehiculo_id            uuid,
  p_tipo                   text default 'material',
  p_conduce_id             uuid default null,
  p_proyecto_id            uuid default null,
  p_origen                 text default null,
  p_destino                text default null,
  p_fecha                  date default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid       uuid := auth.uid();
  v_cond_id   uuid;
  v_dest      text;
  v_origen    text;
  v_ruta      uuid;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '42501'; end if;

  -- Permiso (mismo criterio que el flujo normal de asignación de rutas).
  if not (sgc.is_admin() or sgc.es_referente_movimiento() or sgc.puede_crear_conduce()) then
    raise exception 'No tienes permiso para asignar rutas de transporte.' using errcode = '42501';
  end if;

  -- Idempotencia: si ya existe esa ruta (reintento de la MISMA confirmación), la devuelve.
  if p_id is not null and exists (select 1 from sgc.rutas where id = p_id) then
    return p_id;
  end if;

  -- Resolver el chofer: usuario_id → conductores.id (debe ser un conductor activo).
  select id into v_cond_id from sgc.conductores
   where usuario_id = p_conductor_usuario_id and coalesce(activo, true) limit 1;
  if v_cond_id is null then
    raise exception 'Ese usuario no es un chofer activo — no se le puede asignar una ruta.' using errcode = 'BB404';
  end if;

  if p_vehiculo_id is null then
    raise exception 'Falta el vehículo para la ruta.' using errcode = 'BB400';
  end if;

  -- Origen/destino legibles (para la tarjeta y el registro).
  v_origen := nullif(trim(coalesce(p_origen, '')), '');
  if p_proyecto_id is not null then
    select nombre into v_dest from sgc.proyectos where id = p_proyecto_id;
  end if;
  v_dest := coalesce(nullif(trim(coalesce(p_destino, '')), ''), v_dest, 'Destino');
  v_origen := coalesce(v_origen, 'Origen');

  insert into sgc.rutas (id, vehiculo_id, conductor_id, origen, destino, destino_proyecto_id,
                         fecha, tipo, estado, creado_por)
  values (coalesce(p_id, gen_random_uuid()), p_vehiculo_id, v_cond_id, v_origen, v_dest,
          p_proyecto_id, coalesce(p_fecha, current_date), coalesce(nullif(trim(p_tipo),''),'material'),
          'planificada', v_uid)
  returning id into v_ruta;

  -- Parada inicial hacia el destino.
  insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, proyecto_id, estado)
  values (v_ruta, 1, v_dest, p_proyecto_id, 'pendiente');

  -- Vincular un conduce existente a esta ruta (si se pidió y aún no tiene ruta).
  if p_conduce_id is not null then
    update sgc.salidas_inventario
       set ruta_id = v_ruta
     where id = p_conduce_id and ruta_id is null;
  end if;

  return v_ruta;
end;
$$;
grant execute on function sgc.asistente_crear_ruta(uuid, uuid, uuid, text, uuid, uuid, text, text, date)
  to authenticated, service_role;
