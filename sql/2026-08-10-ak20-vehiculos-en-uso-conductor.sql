-- =============================================================================
-- PROMPT-1 FASE 2 (AK20/AK14/AK15/AK19) — Ronda 10/08/2026. SGC padre.
-- Modelo "en uso / libre": sesiones de uso de vehículo. Aditivo, retrocompatible.
--
-- Decisiones (Xaviel 10-ago): los vehículos son LIBRES; se elimina "asignarme".
-- Quien va a usar hace "Uso de vehículo"; si otro lo tenía, "recibe de X"; al
-- terminar lo "suelta". El estado del vehículo lo cubre el reporte semanal.
--
-- AK19 (causa raíz confirmada): usuarios con VARIAS filas en sgc.conductores
--   (p.ej. Papo: 2 filas) rompen los checks .single()/limit-1 → "no eres conductor"
--   y desaparecen de listados (multas AK17). Se deduplica y se blinda con índice.
-- AK14 (causa raíz): "por_recibir" listaba vehiculos.responsable_id sin custodia
--   abierta; registrar combustible no abría custodia → el vehículo se quedaba en el
--   limbo. Ahora "en uso" se deriva de la sesión de uso.
-- AK15: nivel de gasolina al iniciar y al soltar; adiós pre-uso/"recibir vehículo".
--
-- BRIDGE de bajo riesgo: iniciar/soltar mantienen sincronizado vehiculos.responsable_id
--   = tenedor actual, para que combustible (AF18), reporte semanal (AF8/AK10) y las
--   pantallas legacy sigan funcionando sin reescribir sus RPCs gigantes.
-- =============================================================================

begin;

-- ── 1) AK19 — Deduplicar sgc.conductores por usuario y blindar ────────────────
-- Canónico = fila activa más antigua. Se repuntan TODAS las FKs y se borran extras.
create temporary table _cond_dedup on commit drop as
with dups as (
  select id, usuario_id,
         row_number() over (partition by usuario_id order by activo desc, created_at asc) as rn
  from sgc.conductores
  where usuario_id is not null
),
canon as (select usuario_id, id as canon_id from dups where rn = 1)
select d.id as old_id, c.canon_id
from dups d
join canon c on c.usuario_id = d.usuario_id
where d.rn > 1 and d.id <> c.canon_id;

update sgc.avisos_flota        t set conductor_id    = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.checklists_vehiculo t set conductor_id    = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.conduce_transferencias t set de_conductor_id = e.canon_id from _cond_dedup e where t.de_conductor_id = e.old_id;
update sgc.conduce_transferencias t set a_conductor_id  = e.canon_id from _cond_dedup e where t.a_conductor_id  = e.old_id;
update sgc.conductor_multas     t set conductor_id    = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.registros_combustible t set conductor_id   = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.rutas                t set conductor_id    = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.salidas_inventario   t set conductor_id    = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.vehiculo_accidentes  t set conductor_id    = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;
update sgc.vehiculo_asignaciones t set conductor_id   = e.canon_id from _cond_dedup e where t.conductor_id    = e.old_id;

delete from sgc.conductores c using _cond_dedup e where c.id = e.old_id;

-- Un solo conductor por usuario a partir de ahora (evita el bug de raíz).
create unique index if not exists uq_conductores_usuario
  on sgc.conductores(usuario_id) where usuario_id is not null;

-- ── 1b) Tabla de sesiones de uso (antes de las funciones que la referencian) ──
create table if not exists sgc.vehiculo_usos (
  id                       uuid primary key default gen_random_uuid(),
  vehiculo_id              uuid not null references sgc.vehiculos(id),
  usuario_id               uuid not null references sgc.usuarios(id),
  inicio_at                timestamptz not null default now(),
  fin_at                   timestamptz,
  km_inicio                numeric,
  km_fin                   numeric,
  nivel_combustible_inicio text check (nivel_combustible_inicio is null or nivel_combustible_inicio in ('E','1/4','1/2','3/4','F')),
  nivel_combustible_fin    text check (nivel_combustible_fin    is null or nivel_combustible_fin    in ('E','1/4','1/2','3/4','F')),
  recibido_de              uuid references sgc.usuarios(id),
  notas                    text,
  es_prueba                boolean not null default false,
  created_at               timestamptz not null default now()
);
comment on table sgc.vehiculo_usos is 'AK20 — sesiones de uso de vehículo (modelo en uso/libre). fin_at null = en uso.';
create unique index if not exists uq_vehiculo_uso_activo on sgc.vehiculo_usos(vehiculo_id) where fin_at is null;
create index if not exists ix_vehiculo_usos_usuario  on sgc.vehiculo_usos(usuario_id, inicio_at desc);
create index if not exists ix_vehiculo_usos_vehiculo on sgc.vehiculo_usos(vehiculo_id, inicio_at desc);

alter table sgc.vehiculo_usos enable row level security;
drop policy if exists vehiculo_usos_read on sgc.vehiculo_usos;
create policy vehiculo_usos_read on sgc.vehiculo_usos for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_flota_elevado() or sgc.es_tecnologia());
grant select on sgc.vehiculo_usos to authenticated, service_role;

-- ── 2) es_conductor ampliado + asegurar_conductor robusto (AK19) ──────────────
-- "Es conductor" = rol chofer/transportista O tiene/tuvo sesión de uso de vehículo
-- O ya tiene ficha de conductor. Nunca por asignación legacy.
create or replace function sgc.es_conductor_ampliado(p_uid uuid default null)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.conductores c where c.usuario_id = coalesce(p_uid, auth.uid())
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = coalesce(p_uid, auth.uid()) and r.codigo = 'chofer_transportista'
  ) or exists (
    select 1 from sgc.vehiculo_usos vu where vu.usuario_id = coalesce(p_uid, auth.uid())
  );
$$;
grant execute on function sgc.es_conductor_ampliado(uuid) to authenticated, service_role;

-- asegurar_conductor_de_usuario: ordena por activo (no revienta con duplicados) y
-- crea la ficha también para quien tenga sesión de uso (no solo rol chofer).
create or replace function sgc.asegurar_conductor_de_usuario(p_usuario_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_cid uuid; v_nombre text; v_email text; v_cedula text;
begin
  if p_usuario_id is null then return null; end if;

  select id into v_cid from sgc.conductores
    where usuario_id = p_usuario_id
    order by activo desc, created_at asc limit 1;
  if v_cid is not null then return v_cid; end if;

  -- Garantizamos la ficha para rol chofer O quien tenga sesión de uso de vehículo.
  if not exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = p_usuario_id and r.codigo = 'chofer_transportista')
     and not exists (select 1 from sgc.vehiculo_usos vu where vu.usuario_id = p_usuario_id)
  then
    return null;
  end if;

  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  select email  into v_email  from auth.users where id = p_usuario_id;
  if v_email ~ '^c-[0-9]+@conductores\.constructorasd\.local$' then
    v_cedula := split_part(substring(v_email from 3), '@', 1);
  end if;
  if v_cedula is not null then
    select id into v_cid from sgc.conductores where cedula = v_cedula and usuario_id is null limit 1;
    if v_cid is not null then
      update sgc.conductores set usuario_id = p_usuario_id, updated_at = now() where id = v_cid;
      return v_cid;
    end if;
  end if;
  if v_cedula is null or exists (select 1 from sgc.conductores where cedula = v_cedula) then
    v_cedula := coalesce(v_cedula, 'SIN-CED') || '-' || left(replace(p_usuario_id::text, '-', ''), 8);
  end if;
  insert into sgc.conductores (cedula, nombre, licencia_tipo, tipo_vehiculo_autorizado, activo, usuario_id)
  values (v_cedula, coalesce(nullif(v_nombre,''),'Conductor'), '01', 'Liviano', true, p_usuario_id)
  returning id into v_cid;
  return v_cid;
end;
$$;

-- ── 4) RPC iniciar/recibir uso ───────────────────────────────────────────────
create or replace function sgc.iniciar_uso_vehiculo(
  p_vehiculo_id uuid,
  p_km          numeric default null,
  p_nivel       text    default null,
  p_notas       text    default null,
  p_recibir     boolean default false
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_v sgc.vehiculos%rowtype;
  v_activa sgc.vehiculo_usos%rowtype;
  v_uso_id uuid;
  v_prev uuid;
  v_prev_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_conductor_ampliado(v_uid)) then
    raise exception 'Tu usuario no puede tomar vehículos en uso.' using errcode = '42501';
  end if;

  select * into v_v from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;
  if not coalesce(v_v.activo, true) then raise exception 'Vehículo inactivo.'; end if;

  -- ¿Sesión activa?
  select * into v_activa from sgc.vehiculo_usos where vehiculo_id = p_vehiculo_id and fin_at is null limit 1;

  if found and v_activa.usuario_id = v_uid then
    return jsonb_build_object('ok', true, 'estado', 'ya_en_uso', 'uso_id', v_activa.id, 'vehiculo_id', p_vehiculo_id);
  end if;

  if found and v_activa.usuario_id <> v_uid then
    if not p_recibir then
      select nombre into v_prev_nombre from sgc.usuarios where id = v_activa.usuario_id;
      raise exception 'El vehículo está en uso por %.', coalesce(v_prev_nombre,'otro usuario')
        using errcode = 'DR409',
              detail = jsonb_build_object('en_uso_por', v_activa.usuario_id, 'nombre', v_prev_nombre, 'desde', v_activa.inicio_at)::text;
    end if;
    -- Recibir de X: cierro su sesión y abro la mía (hereda condiciones).
    v_prev := v_activa.usuario_id;
    update sgc.vehiculo_usos
      set fin_at = now(),
          km_fin = coalesce(p_km, km_fin),
          nivel_combustible_fin = coalesce(nivel_combustible_fin, v_activa.nivel_combustible_inicio),
          notas = concat_ws(' · ', notas, 'Recibido por otro usuario')
      where id = v_activa.id;
    -- Cierra también la custodia legacy del anterior, si la hubiera (evita AH12 dual-owner).
    update sgc.vehiculo_entregas
      set estado = 'cerrada'
      where vehiculo_id = p_vehiculo_id and conductor_usuario_id = v_prev
        and tipo = 'recepcion' and estado = 'abierta';
  end if;

  insert into sgc.vehiculo_usos (vehiculo_id, usuario_id, km_inicio, nivel_combustible_inicio, recibido_de, notas, es_prueba)
  values (p_vehiculo_id, v_uid, p_km, nullif(p_nivel,''), v_prev, p_notas, coalesce(v_v.es_prueba, false))
  returning id into v_uso_id;

  -- BRIDGE legacy: el tenedor actual queda como responsable_id (combustible/reporte).
  update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;
  -- Avanza odómetro si se aportó km.
  if p_km is not null then
    begin perform sgc.avanzar_odometro(p_vehiculo_id, p_km::int); exception when others then null; end;
  end if;
  -- Garantiza ficha de conductor (para que Mi actividad/combustible funcionen).
  perform sgc.asegurar_conductor_de_usuario(v_uid);

  -- Notifica al anterior tenedor que su vehículo fue recibido.
  if v_prev is not null then
    perform sgc.notificar(v_prev, 'flota', 'Tu vehículo fue recibido',
      'Otro usuario recibió el vehículo '||coalesce(v_v.placa,'')||' que tenías en uso.', '/flota/mi-actividad');
  end if;

  return jsonb_build_object('ok', true,
    'estado', case when v_prev is not null then 'recibido' else 'iniciado' end,
    'uso_id', v_uso_id, 'vehiculo_id', p_vehiculo_id, 'recibido_de', v_prev);
end;
$$;
grant execute on function sgc.iniciar_uso_vehiculo(uuid, numeric, text, text, boolean) to authenticated, service_role;

-- ── 5) RPC soltar vehículo ───────────────────────────────────────────────────
create or replace function sgc.soltar_vehiculo(
  p_vehiculo_id uuid,
  p_km          numeric default null,
  p_nivel       text    default null,
  p_notas       text    default null
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_uso sgc.vehiculo_usos%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_uso from sgc.vehiculo_usos
    where vehiculo_id = p_vehiculo_id and fin_at is null
      and (usuario_id = v_uid or sgc.is_admin()) limit 1;
  if not found then raise exception 'No tienes este vehículo en uso.'; end if;

  update sgc.vehiculo_usos
    set fin_at = now(),
        km_fin = coalesce(p_km, km_fin),
        nivel_combustible_fin = coalesce(nullif(p_nivel,''), nivel_combustible_fin),
        notas = concat_ws(' · ', notas, nullif(p_notas,''))
    where id = v_uso.id;

  -- Libera el bridge legacy (queda sin responsable = libre).
  update sgc.vehiculos set responsable_id = null where id = p_vehiculo_id and responsable_id = v_uso.usuario_id;
  if p_km is not null then
    begin perform sgc.avanzar_odometro(p_vehiculo_id, p_km::int); exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'estado', 'libre', 'uso_id', v_uso.id, 'vehiculo_id', p_vehiculo_id);
end;
$$;
grant execute on function sgc.soltar_vehiculo(uuid, numeric, text, text) to authenticated, service_role;

-- ── 6) Lecturas: mi uso activo, estado del vehículo, en uso (elevados), historial
create or replace function sgc.mi_uso_activo()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce((
    select jsonb_build_object(
      'uso_id', vu.id, 'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
      'modelo', v.modelo, 'anio', v.anio, 'km', v.kilometraje,
      'km_inicio', vu.km_inicio, 'nivel_inicio', vu.nivel_combustible_inicio,
      'desde', vu.inicio_at, 'recibido_de', vu.recibido_de)
    from sgc.vehiculo_usos vu join sgc.vehiculos v on v.id = vu.vehiculo_id
    where vu.usuario_id = auth.uid() and vu.fin_at is null
    order by vu.inicio_at desc limit 1
  ), 'null'::jsonb);
$$;
grant execute on function sgc.mi_uso_activo() to authenticated, service_role;

create or replace function sgc.estado_uso_vehiculo(p_vehiculo_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce((
    select jsonb_build_object(
      'libre', false, 'usuario_id', vu.usuario_id,
      'usuario_nombre', u.nombre, 'desde', vu.inicio_at,
      'km_inicio', vu.km_inicio, 'nivel_inicio', vu.nivel_combustible_inicio,
      'es_mio', (vu.usuario_id = auth.uid()))
    from sgc.vehiculo_usos vu join sgc.usuarios u on u.id = vu.usuario_id
    where vu.vehiculo_id = p_vehiculo_id and vu.fin_at is null limit 1
  ), jsonb_build_object('libre', true));
$$;
grant execute on function sgc.estado_uso_vehiculo(uuid) to authenticated, service_role;

create or replace function sgc.vehiculos_en_uso()
returns table (vehiculo_id uuid, placa text, marca text, modelo text, usuario_id uuid, usuario_nombre text, desde timestamptz, km_inicio numeric, nivel_inicio text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select v.id, v.placa, v.marca, v.modelo, vu.usuario_id, u.nombre, vu.inicio_at, vu.km_inicio, vu.nivel_combustible_inicio
  from sgc.vehiculo_usos vu
  join sgc.vehiculos v on v.id = vu.vehiculo_id
  join sgc.usuarios u on u.id = vu.usuario_id
  where vu.fin_at is null
    and (sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia())
    and ((not coalesce(v.es_prueba,false)) or sgc.is_admin())
  order by vu.inicio_at desc;
$$;
grant execute on function sgc.vehiculos_en_uso() to authenticated, service_role;

-- Historial de MIS usos (Mi actividad) — solo lectura.
create or replace function sgc.mis_usos_vehiculo(p_desde date default null, p_hasta date default null)
returns table (id uuid, vehiculo_id uuid, placa text, marca text, modelo text,
               inicio_at timestamptz, fin_at timestamptz, km_inicio numeric, km_fin numeric,
               nivel_inicio text, nivel_fin text, recibido_de uuid, activa boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select vu.id, v.id, v.placa, v.marca, v.modelo, vu.inicio_at, vu.fin_at,
         vu.km_inicio, vu.km_fin, vu.nivel_combustible_inicio, vu.nivel_combustible_fin,
         vu.recibido_de, (vu.fin_at is null)
  from sgc.vehiculo_usos vu join sgc.vehiculos v on v.id = vu.vehiculo_id
  where vu.usuario_id = auth.uid()
    and (p_desde is null or vu.inicio_at::date >= p_desde)
    and (p_hasta is null or vu.inicio_at::date <= p_hasta)
  order by vu.inicio_at desc
  limit 300;
$$;
grant execute on function sgc.mis_usos_vehiculo(date, date) to authenticated, service_role;

-- ── 7) AK14 — "Por recibir" refleja el modelo nuevo ──────────────────────────
-- a_cargo = vehículo con MI sesión de uso activa (nuevo) o MI custodia abierta (legacy).
-- por_recibir = otro lo dejó a mi cargo (responsable_id) SIN sesión de uso activa mía
--   ni de nadie, y sin custodia abierta. Si yo ya lo tengo en uso, NO sale en por_recibir.
create or replace function sgc.mis_pendientes_transporte()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'public'
as $$
  select jsonb_build_object(
    'a_cargo', (
      select coalesce(jsonb_agg(x order by x->>'desde' desc), '[]'::jsonb) from (
        -- Sesión de uso activa (modelo nuevo)
        select jsonb_build_object(
          'uso_id', vu.id, 'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
          'modelo', v.modelo, 'anio', v.anio, 'km', v.kilometraje,
          'nivel_inicio', vu.nivel_combustible_inicio, 'desde', vu.inicio_at, 'fuente', 'uso') as x
        from sgc.vehiculo_usos vu
        join sgc.vehiculos v on v.id = vu.vehiculo_id
        where vu.usuario_id = auth.uid() and vu.fin_at is null
          and ((not coalesce(v.es_prueba,false)) or sgc.is_admin())
        union all
        -- Custodia legacy abierta sin sesión de uso (retrocompat)
        select jsonb_build_object(
          'entrega_id', e.id, 'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
          'modelo', v.modelo, 'anio', v.anio, 'km', e.km, 'desde', e.capturado_en, 'fuente', 'custodia')
        from sgc.vehiculo_entregas e
        join sgc.vehiculos v on v.id = e.vehiculo_id
        where e.conductor_usuario_id = auth.uid() and e.tipo = 'recepcion' and e.estado = 'abierta'
          and not exists (select 1 from sgc.vehiculo_usos vu2 where vu2.vehiculo_id = v.id and vu2.fin_at is null)
          and ((not coalesce(e.es_prueba, false)) or sgc.is_admin())
          and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
      ) t
    ),
    'por_recibir', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
        'modelo', v.modelo, 'anio', v.anio, 'km', v.kilometraje)), '[]'::jsonb)
      from sgc.vehiculos v
      where v.responsable_id = auth.uid() and coalesce(v.activo, true)
        and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
        and not exists (select 1 from sgc.vehiculo_usos vu where vu.vehiculo_id = v.id and vu.fin_at is null)
        and not exists (select 1 from sgc.vehiculo_entregas e
                        where e.vehiculo_id = v.id and e.tipo = 'recepcion' and e.estado = 'abierta')
    )
  );
$$;

commit;
