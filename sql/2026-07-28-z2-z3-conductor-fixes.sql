-- ============================================================================
-- Z2 + Z3 — Fixes de Conductores · PROMPT-6 · FASE 1
-- ============================================================================

-- Z2 — auto_registrar_conductor: al no encontrar conductor propio, vincular por
-- cédula (aunque no tenga usuario) y, si la cédula pertenece a OTRA cuenta,
-- error claro en español en vez del choque crudo conductores_cedula_key.
create or replace function sgc.auto_registrar_conductor(
  p_cedula text, p_licencia_tipo text, p_licencia_numero text default null,
  p_licencia_vencimiento date default null, p_tipo_vehiculo_autorizado text default 'Ambos')
returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_cond_id uuid;
  v_owner uuid;
  v_lic_venc date;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(p_cedula),'') is null then raise exception 'La cédula es obligatoria'; end if;
  if nullif(trim(p_licencia_tipo),'') is null then raise exception 'El tipo de licencia es obligatorio'; end if;
  if coalesce(p_tipo_vehiculo_autorizado,'Ambos') not in ('Liviano','Pesado','Ambos') then
    raise exception 'Tipo de vehículo autorizado inválido';
  end if;

  select nombre into v_nombre from sgc.usuarios where id = v_uid;

  -- 1) Ya es conductor vinculado a este usuario.
  select id into v_cond_id from sgc.conductores where usuario_id = v_uid limit 1;

  -- 2) Si no, buscar por cédula (con o sin usuario). Si pertenece a OTRA cuenta -> error claro.
  if v_cond_id is null then
    select id, usuario_id into v_cond_id, v_owner
      from sgc.conductores where cedula = trim(p_cedula) limit 1;
    if v_cond_id is not null and v_owner is not null and v_owner <> v_uid then
      raise exception 'Ya existe un conductor registrado con la cédula % vinculado a otra cuenta. Contacta al administrador para resolverlo.', trim(p_cedula)
        using errcode = '23505';
    end if;
  end if;

  if v_cond_id is not null then
    update sgc.conductores set
      cedula = trim(p_cedula),
      nombre = coalesce(nombre, v_nombre),
      licencia_tipo = trim(p_licencia_tipo),
      licencia_numero = nullif(trim(p_licencia_numero),''),
      licencia_vencimiento = p_licencia_vencimiento,
      tipo_vehiculo_autorizado = coalesce(p_tipo_vehiculo_autorizado,'Ambos'),
      usuario_id = v_uid,
      activo = true,
      updated_at = now()
    where id = v_cond_id;
  else
    insert into sgc.conductores (
      cedula, nombre, telefono, licencia_tipo, licencia_numero, licencia_vencimiento,
      tipo_vehiculo_autorizado, usuario_id, activo
    ) values (
      trim(p_cedula), coalesce(v_nombre,'Conductor'), null, trim(p_licencia_tipo),
      nullif(trim(p_licencia_numero),''), p_licencia_vencimiento,
      coalesce(p_tipo_vehiculo_autorizado,'Ambos'), v_uid, true
    ) returning id into v_cond_id;
  end if;

  select licencia_vencimiento into v_lic_venc from sgc.conductores where id = v_cond_id;
  return jsonb_build_object(
    'conductor_id', v_cond_id,
    'licencia_vencida', (v_lic_venc is not null and v_lic_venc < current_date),
    'licencia_vencimiento', v_lic_venc);
end;
$function$;

-- Z3 — v_conductor_stats expone es_prueba (para que Estados de conductores lo
-- filtre igual que las demás listas). Mantener security_invoker=true.
create or replace view sgc.v_conductor_stats
with (security_invoker = true) as
 SELECT c.id AS conductor_id,
    c.nombre,
    c.licencia_vencimiento,
        CASE
            WHEN c.licencia_vencimiento IS NULL THEN 'sin_dato'::text
            WHEN c.licencia_vencimiento < CURRENT_DATE THEN 'vencida'::text
            WHEN c.licencia_vencimiento <= (CURRENT_DATE + 30) THEN 'por_vencer'::text
            ELSE 'vigente'::text
        END AS estado_licencia,
    COALESCE(ck.n_checklists, 0::bigint) AS checklists_total,
    COALESCE(ck.n_bloqueos, 0::bigint) AS checklists_bloqueos,
    ck.ultimo_checklist,
    COALESCE(fc.n_echadas, 0::bigint) AS combustible_echadas,
    fc.ultima_echada,
    COALESCE(uv.vehiculos_usados, 0::bigint) AS vehiculos_usados,
    GREATEST(ck.ultimo_checklist, fc.ultima_echada) AS ultima_actividad,
    c.es_prueba
   FROM sgc.conductores c
     LEFT JOIN ( SELECT checklists_vehiculo.conductor_id,
            count(*) AS n_checklists,
            count(*) FILTER (WHERE checklists_vehiculo.resultado = 'bloqueado'::text) AS n_bloqueos,
            max(checklists_vehiculo.fecha) AS ultimo_checklist
           FROM sgc.checklists_vehiculo
          WHERE checklists_vehiculo.conductor_id IS NOT NULL
          GROUP BY checklists_vehiculo.conductor_id) ck ON ck.conductor_id = c.id
     LEFT JOIN ( SELECT registros_combustible.conductor_id,
            count(*) AS n_echadas,
            max(registros_combustible.fecha) AS ultima_echada
           FROM sgc.registros_combustible
          WHERE registros_combustible.conductor_id IS NOT NULL
          GROUP BY registros_combustible.conductor_id) fc ON fc.conductor_id = c.id
     LEFT JOIN ( SELECT checklists_vehiculo.conductor_id,
            count(DISTINCT checklists_vehiculo.vehiculo_id) AS vehiculos_usados
           FROM sgc.checklists_vehiculo
          WHERE checklists_vehiculo.conductor_id IS NOT NULL
          GROUP BY checklists_vehiculo.conductor_id) uv ON uv.conductor_id = c.id;
