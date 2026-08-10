-- =============================================================================
-- PROMPT-1 FASE 4 (AK16) — Aviso de vehículo: voz + video + gestión. SGC padre.
-- Aditivo, retrocompatible. La bandeja de gestión (nuevo→atendido) e historial YA
-- existen (avisos_flota + página /flota/avisos + atender_aviso_flota). Aquí:
--   (1) nota de voz: habilitar audio_notas para entidad 'aviso_flota' (patrón AH13).
--   (2) video: columna videos[] en avisos_flota + parámetro en el RPC (bucket vehiculos
--       ya acepta cualquier mime).
--   (3) notificación del aviso NUEVO a la matriz (jefe de flota, logística, admin,
--       gerencia — configurable), no a todo el módulo (evita spam a choferes).
--   (4) "mis reportes" del chofer.
-- =============================================================================

begin;

-- ── 1) Voz: ampliar el CHECK de audio_notas con 'aviso_flota' (patrón AH13) ────
alter table sgc.audio_notas drop constraint if exists audio_notas_entidad_tipo_check;
alter table sgc.audio_notas add constraint audio_notas_entidad_tipo_check
  check (entidad_tipo = any (array[
    'bitacora','incidente','accidente','reporte_semanal','preuso','mantenimiento',
    'ruta','checklist','otro','traspaso_acta','aviso_flota'
  ]));

-- ── 2) Video: columna de adjuntos de video en avisos_flota ────────────────────
alter table sgc.avisos_flota add column if not exists videos text[] not null default '{}';
comment on column sgc.avisos_flota.videos is 'AK16 — paths de video (bucket vehiculos) adjuntos a la novedad.';

-- ── 3) Parámetro: roles a notificar cuando entra una novedad ──────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('aviso_vehiculo_roles', 'jefe_flota,logistica,admin,gerencia',
   'AK16 — roles notificados cuando se reporta una novedad de vehículo (CSV roles.codigo).')
on conflict (clave) do nothing;

-- ── 4) reportar_novedad_vehiculo con video + notificación por rol ─────────────
-- Se elimina la versión de 4 args (con defaults) para evitar ambigüedad; la nueva
-- de 5 args con defaults cubre las llamadas de 4 args (p_videos por defecto).
drop function if exists sgc.reportar_novedad_vehiculo(uuid, text, text, text[]);
create or replace function sgc.reportar_novedad_vehiculo(
  p_vehiculo_id uuid,
  p_descripcion text,
  p_severidad   text default 'media',
  p_fotos       text[] default '{}',
  p_videos      text[] default '{}'
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_cid uuid; v_placa text; v_id uuid; v_es_prueba boolean; v_rol text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_descripcion,'')),'') is null then
    raise exception 'La descripción de la novedad es obligatoria.';
  end if;
  if p_severidad not in ('baja','media','alta') then p_severidad := 'media'; end if;

  select v.placa, coalesce(v.es_prueba,false) into v_placa, v_es_prueba
  from sgc.vehiculos v where v.id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado.'; end if;

  select id into v_cid from sgc.conductores where usuario_id = v_uid order by activo desc, created_at asc limit 1;

  insert into sgc.avisos_flota (
    tipo, vehiculo_id, conductor_id, mensaje, severidad, estado,
    fotos, videos, reportado_por, es_prueba, es_prueba_origen
  ) values (
    'novedad', p_vehiculo_id, v_cid, trim(p_descripcion), p_severidad, 'pendiente',
    coalesce(p_fotos,'{}'), coalesce(p_videos,'{}'), v_uid, v_es_prueba,
    case when v_es_prueba then 'novedad:vehiculo_prueba' else null end
  ) returning id into v_id;

  -- AK16: notifica a los roles designados (no a todo el módulo → evita spam a choferes).
  -- es_prueba: no molestamos con novedades de prueba salvo que el destinatario sea admin
  -- (notificar_rol ya inserta por usuario; el filtrado fino de prueba se deja al canal).
  if not v_es_prueba then
    foreach v_rol in array sgc.param_csv('aviso_vehiculo_roles','jefe_flota,logistica,admin,gerencia') loop
      perform sgc.notificar_rol(
        v_rol, 'novedad',
        'Novedad de vehículo' || coalesce(' — ' || v_placa, ''),
        trim(p_descripcion),
        '/flota/avisos');
    end loop;
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.reportar_novedad_vehiculo(uuid, text, text, text[], text[]) to authenticated, service_role;

-- ── 5) "Mis reportes" del chofer (listado + estado) ──────────────────────────
create or replace function sgc.mis_novedades_reportadas(p_desde date default null, p_hasta date default null)
returns table (
  id uuid, vehiculo_id uuid, placa text, mensaje text, severidad text,
  estado text, fotos text[], videos text[], created_at timestamptz,
  atendido_por uuid, atendido_por_nombre text, atendido_at timestamptz, nota_atencion text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select a.id, a.vehiculo_id, v.placa::text, a.mensaje, a.severidad,
         a.estado, a.fotos, a.videos, a.created_at,
         a.atendido_por, ua.nombre::text, a.atendido_at, a.nota_atencion
  from sgc.avisos_flota a
  left join sgc.vehiculos v on v.id = a.vehiculo_id
  left join sgc.usuarios ua on ua.id = a.atendido_por
  where a.reportado_por = auth.uid() and a.tipo = 'novedad'
    and (p_desde is null or a.created_at::date >= p_desde)
    and (p_hasta is null or a.created_at::date <= p_hasta)
  order by a.created_at desc
  limit 300;
$$;
grant execute on function sgc.mis_novedades_reportadas(date, date) to authenticated, service_role;

commit;
