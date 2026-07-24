-- ============================================================================
-- PROMPT-21 · FASE 2 (Y4) — 2026-07-24 — Tiempos reales de ruta (BD).
-- Aditivo/idempotente. El instante del TAP lo captura el cliente (offline-first)
-- y el RPC lo usa con sanity check; fallback now(). Duración real = fin − inicio.
-- La estimación del maps (tiempo_estimado_min) ya se guarda al crear desde la web
-- (OSRM en recalcularRuta); aquí se añade también al RPC crear_ruta_app (app).
-- ============================================================================

-- 2.1 — columnas aditivas (timestamptz del TAP).
ALTER TABLE sgc.rutas ADD COLUMN IF NOT EXISTS iniciada_at   timestamptz;
ALTER TABLE sgc.rutas ADD COLUMN IF NOT EXISTS finalizada_at timestamptz;

-- Evitar overloads: dropear las firmas viejas para que las llamadas con menos
-- args resuelvan a las nuevas (con DEFAULTs). Idempotente.
DROP FUNCTION IF EXISTS sgc.marcar_ruta_estado(uuid, text);
DROP FUNCTION IF EXISTS sgc.crear_ruta_app(uuid, uuid, uuid, text, text, date, numeric, text, uuid, numeric, numeric, timestamptz, numeric, numeric);

-- 2.1 — marcar_ruta_estado registra el instante del TAP con sanity check
-- (no futuro, no anterior a la creación de la ruta; fin ≥ inicio). Fallback now().
CREATE OR REPLACE FUNCTION sgc.marcar_ruta_estado(p_ruta_id uuid, p_estado text, p_at timestamptz DEFAULT NULL::timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_ruta sgc.rutas%rowtype;
  v_at   timestamptz;
begin
  if p_estado not in ('en_curso', 'completada', 'cancelada') then
    raise exception 'Estado inválido: %', p_estado;
  end if;
  select * into v_ruta from sgc.rutas where id = p_ruta_id for update;
  if not found then raise exception 'Ruta no encontrada.'; end if;
  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_ruta.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor de esta ruta.';
  end if;

  -- Sanity: el TAP no puede ser futuro ni anterior a la creación de la ruta.
  v_at := least(greatest(coalesce(p_at, now()), v_ruta.created_at), now());

  if p_estado = 'en_curso' then
    update sgc.rutas
       set estado = p_estado,
           iniciada_at = coalesce(iniciada_at, v_at),   -- conserva el primer TAP de inicio
           updated_at = now()
     where id = p_ruta_id;
  elsif p_estado = 'completada' then
    -- fin ≥ inicio (evita duraciones negativas por skew de reloj).
    v_at := greatest(v_at, coalesce(v_ruta.iniciada_at, v_ruta.created_at));
    update sgc.rutas
       set estado = p_estado,
           finalizada_at = v_at,
           updated_at = now()
     where id = p_ruta_id;
  else  -- cancelada
    update sgc.rutas set estado = p_estado, updated_at = now() where id = p_ruta_id;
  end if;
end;
$function$;

-- 2.2 — crear_ruta_app persiste la estimación del maps (tiempo_estimado_min).
-- Param nuevo al final, DEFAULT NULL → llamadas actuales por nombre siguen resolviendo.
CREATE OR REPLACE FUNCTION sgc.crear_ruta_app(p_id uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_origen text, p_destino text, p_fecha date DEFAULT CURRENT_DATE, p_km_estimado numeric DEFAULT NULL::numeric, p_notas text DEFAULT NULL::text, p_destino_proyecto_id uuid DEFAULT NULL::uuid, p_destino_lat numeric DEFAULT NULL::numeric, p_destino_lng numeric DEFAULT NULL::numeric, p_capturado_en timestamp with time zone DEFAULT now(), p_origen_lat numeric DEFAULT NULL::numeric, p_origen_lng numeric DEFAULT NULL::numeric, p_tiempo_estimado_min integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_cond uuid := p_conductor_id;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  if exists (select 1 from sgc.rutas where id = p_id) then
    return p_id;
  end if;

  if nullif(trim(p_origen), '') is null then raise exception 'El origen es obligatorio'; end if;
  if nullif(trim(p_destino), '') is null then raise exception 'El destino es obligatorio'; end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  if v_cond is null then
    select id into v_cond from sgc.conductores where usuario_id = v_uid and activo limit 1;
  end if;

  insert into sgc.rutas (
    id, vehiculo_id, conductor_id, origen, destino, fecha, km_estimado, tiempo_estimado_min, notas,
    destino_proyecto_id, destino_lat, destino_lng, origen_lat, origen_lng,
    estado, creado_por, created_at, updated_at
  ) values (
    p_id, p_vehiculo_id, v_cond, sgc.homologar_texto(p_origen), sgc.homologar_texto(p_destino),
    coalesce(p_fecha, current_date), p_km_estimado, p_tiempo_estimado_min, nullif(trim(p_notas), ''),
    p_destino_proyecto_id, p_destino_lat, p_destino_lng, p_origen_lat, p_origen_lng,
    'planificada', v_uid, coalesce(p_capturado_en, now()), now()
  );

  return p_id;
end;
$function$;
