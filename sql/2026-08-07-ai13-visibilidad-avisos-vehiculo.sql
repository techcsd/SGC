-- ============================================================================
-- AI13 — Visibilidad de vehículos a choferes + "Aviso de vehículo" (novedades).
--       SGC padre. Aditivo/retrocompatible.
-- ----------------------------------------------------------------------------
--   (a) vehiculos.visible_choferes (default true): admin/jefe de flota puede
--       ocultar un vehículo a los choferes (ej. Hyundai Cantus, motos,
--       administrativos). Filtro server-side en la política SELECT de vehiculos:
--       un CHOFER solo ve los visibles; flota-elevado y no-choferes ven todo.
--   (b) Novedades reportadas por el chofer → caen en la bandeja EXISTENTE
--       Flota > Avisos (sgc.avisos_flota, tipo 'novedad') con foto(s) + severidad;
--       notifica in-app a flota. NO se crea panel paralelo.
--   (c) alertas_vehiculo(uuid): las alertas del vehículo (documentos por vencer,
--       mantenimiento próximo, placa PP, avisos abiertos) para la pestaña
--       "Alertas" de la app.
-- ============================================================================

set search_path = sgc, public;

-- ── (a) Flag de visibilidad + política SELECT ───────────────────────────────
alter table sgc.vehiculos
  add column if not exists visible_choferes boolean not null default true;
comment on column sgc.vehiculos.visible_choferes is 'AI13 — si false, el vehículo NO aparece en los selects de los choferes (admin/jefe de flota lo controla).';

drop policy if exists "vehiculos: select" on sgc.vehiculos;
create policy "vehiculos: select" on sgc.vehiculos for select to authenticated
using (
  (
    activo = true
    and sgc.tiene_modulo('flota')
    -- AI13: un chofer solo ve vehículos visibles; los demás usuarios de flota ven todo.
    and (coalesce(visible_choferes, true) or not sgc.es_chofer())
  )
  or sgc.es_flota_elevado()
);

-- Guard suave: un chofer no puede asignarse un vehículo oculto (defensa en profundidad).
-- (La lista ya lo filtra; esto evita el atajo por id.)
create or replace function sgc.vehiculo_visible_para_mi(p_vehiculo_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.vehiculos v
    where v.id = p_vehiculo_id
      and (coalesce(v.visible_choferes, true) or not sgc.es_chofer() or sgc.es_flota_elevado())
  );
$$;
grant execute on function sgc.vehiculo_visible_para_mi(uuid) to authenticated, service_role;

-- ── (b) Novedades en la bandeja de Avisos existente ─────────────────────────
alter table sgc.avisos_flota
  add column if not exists fotos         text[] not null default '{}',
  add column if not exists reportado_por uuid references sgc.usuarios(id) on delete set null;
comment on column sgc.avisos_flota.fotos         is 'AI13 — evidencia fotográfica de la novedad (bucket vehiculos).';
comment on column sgc.avisos_flota.reportado_por is 'AI13 — usuario (chofer) que reportó la novedad.';

-- Ampliar el CHECK de tipo para incluir 'novedad' (conserva todos los tipos previos).
alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add constraint avisos_flota_tipo_chk check (tipo = any (array[
  'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido','consumo_anormal',
  'licencia','matricula','seguro','reporte_semanal','conciliacion',
  'licencia_por_vencer','licencia_vencida','matricula_por_vencer','matricula_vencida',
  'seguro_por_vencer','seguro_vencida','pp_por_vencer','pp_vencida',
  'mantenimiento_por_revisar','novedad'
]));

create or replace function sgc.reportar_novedad_vehiculo(
  p_vehiculo_id uuid,
  p_descripcion text,
  p_severidad   text default 'media',
  p_fotos       text[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid       uuid := auth.uid();
  v_cid       uuid;
  v_placa     text;
  v_id        uuid;
  v_es_prueba boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_descripcion, '')), '') is null then
    raise exception 'La descripción de la novedad es obligatoria.';
  end if;
  if p_severidad not in ('baja','media','alta') then
    p_severidad := 'media';
  end if;

  select v.placa, coalesce(v.es_prueba, false) into v_placa, v_es_prueba
  from sgc.vehiculos v where v.id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;

  -- Conductor del reportante (si tiene fila).
  select id into v_cid from sgc.conductores where usuario_id = v_uid limit 1;

  insert into sgc.avisos_flota (
    tipo, vehiculo_id, conductor_id, mensaje, severidad, estado,
    fotos, reportado_por, es_prueba, es_prueba_origen
  ) values (
    'novedad', p_vehiculo_id, v_cid,
    trim(p_descripcion), p_severidad, 'pendiente',
    coalesce(p_fotos, '{}'), v_uid, v_es_prueba,
    case when v_es_prueba then 'novedad:vehiculo_prueba' else null end
  )
  returning id into v_id;

  -- Notificación in-app a los usuarios del módulo flota (email/push lo dispara la app
  -- vía edge notificar-flota + send-push, coherente con el resto de avisos).
  perform sgc.notificar_modulo(
    'flota', 'novedad',
    'Novedad de vehículo' || coalesce(' — ' || v_placa, ''),
    trim(p_descripcion),
    '/flota/avisos'
  );

  return v_id;
end;
$$;
grant execute on function sgc.reportar_novedad_vehiculo(uuid, text, text, text[]) to authenticated, service_role;

-- ── (c) Alertas del vehículo (pestaña "Alertas" de la app) ──────────────────
create or replace function sgc.alertas_vehiculo(p_vehiculo_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select jsonb_build_object(
    'vehiculo_id', v.id,
    'placa', v.placa,
    'vencimiento_matricula', v.vencimiento_matricula,
    'vencimiento_seguro', v.vencimiento_seguro,
    'kilometraje', v.kilometraje,
    'km_ultimo_mantenimiento', v.km_ultimo_mantenimiento,
    'intervalo_mantenimiento_km', v.intervalo_mantenimiento_km,
    'km_faltan_mantenimiento', case
      when v.km_ultimo_mantenimiento is not null and v.intervalo_mantenimiento_km is not null
        then (v.km_ultimo_mantenimiento + v.intervalo_mantenimiento_km) - coalesce(v.kilometraje, 0)
      else null end,
    'avisos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'tipo', a.tipo, 'mensaje', a.mensaje,
        'severidad', a.severidad, 'estado', a.estado, 'created_at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from sgc.avisos_flota a
      where a.vehiculo_id = v.id and a.estado = 'pendiente'
    ),
    'placas_pp', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pp.id, 'placa_pp', pp.placa_pp,
        'vencimiento', coalesce(pp.fecha_limite, pp.fecha_vencimiento_pp),
        'estado', pp.estado
      ) order by coalesce(pp.fecha_limite, pp.fecha_vencimiento_pp)), '[]'::jsonb)
      from sgc.vehiculo_placas_pp pp
      where pp.vehiculo_id = v.id and coalesce(pp.estado, '') <> 'entregada'
    )
  )
  from sgc.vehiculos v
  where v.id = p_vehiculo_id;
$$;
grant execute on function sgc.alertas_vehiculo(uuid) to authenticated, service_role;
