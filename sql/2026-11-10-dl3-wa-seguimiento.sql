-- =============================================================================
-- DL3/DL6 (ronda DL, 10-nov-2026) — Compa en WhatsApp: seguimiento real de
-- hallazgos (responsable, estado de seguimiento, cierre automático/manual,
-- "Convertir" que SÍ crea una tarea) + base para recordatorios (DL4/F4).
--
-- Contexto (CONTEXTO-ACTUALIZACION-68.md §2.3): hoy "Convertir" solo copia
-- texto al portapapeles y marca estado='convertido' sin crear nada; los
-- hallazgos no tienen responsable; nada se cierra cuando alguien responde.
-- Esta migración es la base de datos de esos tres arreglos. Aditiva,
-- idempotente — extiende sgc.wa_hallazgos/wa_grupos (sql/2026-11-05-db2-…).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl3-wa-seguimiento.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) sgc.wa_hallazgos — responsable + seguimiento + cierre ───────────────
alter table sgc.wa_hallazgos
  add column if not exists responsable_id uuid references sgc.usuarios(id) on delete set null,
  add column if not exists responsable_origen text
    check (responsable_origen is null or responsable_origen in ('ia','manual','grupo','tecnologia')),
  add column if not exists seguimiento text not null default 'sin'
    check (seguimiento in ('sin','activo','resuelto_probable','resuelto','vencido','pausado')),
  add column if not exists seguimiento_desde timestamptz,
  add column if not exists cierre_motivo text,
  add column if not exists cerrado_por_mensaje_id uuid,
  add column if not exists cerrado_en timestamptz,
  add column if not exists ultimo_recordatorio_en timestamptz,
  add column if not exists recordatorios_enviados integer not null default 0,
  add column if not exists convertido_ref_id uuid;

comment on column sgc.wa_hallazgos.seguimiento is
  'DL3 — sin (no aplica/sin revisar) · activo (recordando) · resuelto_probable (IA detectó cierre, confianza 0.5-0.7) · resuelto (cerrado, confianza≥0.7 o manual) · vencido (14 días sin respuesta) · pausado (silenciado a mano).';
comment on column sgc.wa_hallazgos.responsable_origen is
  'DL-08 — de dónde salió responsable_id: ia (mención única) · manual (editado en pantalla) · grupo (wa_grupos.responsables, sin coincidencia única) · tecnologia (nadie más aplica).';

create index if not exists idx_wa_hallazgos_responsable_seguimiento on sgc.wa_hallazgos (responsable_id, seguimiento)
  where seguimiento in ('activo','vencido','resuelto_probable');

-- ── 2) sgc.wa_grupos — responsables del grupo (DL-08, fallback) ────────────
alter table sgc.wa_grupos
  add column if not exists responsables uuid[] not null default '{}';
comment on column sgc.wa_grupos.responsables is
  'DL-08 — a quién recordarle los hallazgos de este grupo cuando no hay una mención única resoluble a un usuario (fallback antes de caer a Tecnología).';

-- ── 3) sgc.wa_recordatorios — log + dedupe de recordatorios enviados ───────
create table if not exists sgc.wa_recordatorios (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid references sgc.usuarios(id) on delete set null,
  canal        text not null check (canal in ('email','inapp','push','whatsapp')),
  nivel        smallint,
  hallazgo_ids uuid[] not null default '{}',
  estado       text not null check (estado in ('enviado','omitido','fallido','fuera_de_ventana','silenciado','prueba')),
  motivo       text,
  dedupe_key   text unique,
  creado_en    timestamptz not null default now()
);
comment on table sgc.wa_recordatorios is
  'DL4/F4 — log de recordatorios de hallazgos de WhatsApp (1 por persona/día/canal vía dedupe_key = usuario|fecha RD|canal). Escritura solo service_role (la edge wa-seguimiento).';

alter table sgc.wa_recordatorios enable row level security;
drop policy if exists wa_recordatorios_sel on sgc.wa_recordatorios;
create policy wa_recordatorios_sel on sgc.wa_recordatorios for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_recordatorios to authenticated;
grant all on sgc.wa_recordatorios to service_role;

-- ── 4) sgc.wa_config — interruptores nuevos (DL-13/DL-19) ──────────────────
alter table sgc.wa_config
  add column if not exists recordatorio_whatsapp boolean not null default false,
  add column if not exists recap_minimo_mensajes integer not null default 5;
comment on column sgc.wa_config.recordatorio_whatsapp is
  'DL-13 — WhatsApp privado de Compa como canal de recordatorio. Apagado por defecto: sin plantilla aprobada de Meta, solo alcanzaría a quien le escribió a Compa en las últimas 24h.';

-- ── 5) Familias de envíos automáticos (sembradas APAGADAS — DL-15) ─────────
insert into sgc.envios_automaticos (familia, nombre, activo) values
  ('wa_recordatorios',   'Recordatorios de pendientes de grupos de WhatsApp', false),
  ('wa_recap_diario',    'Recap diario de grupos de WhatsApp (PDF por correo)', false),
  ('wa_recap_semanal',   'Recap semanal de grupos de WhatsApp (PDF por correo)', false)
on conflict (familia) do nothing;

-- ── 6) Tipos de notificación (DL-14) ────────────────────────────────────────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden) values
  ('wa_recordatorio', 'Pendientes de grupos de WhatsApp',
   'Un hallazgo de un grupo de WhatsApp te quedó asignado y no se ha cerrado.',
   false, array['in_app','push','email']::text[], true, 390),
  ('wa_recap', 'Recap de grupos de WhatsApp',
   'Resumen diario/semanal (PDF) de lo hablado en los grupos de WhatsApp que sigues.',
   false, array['email']::text[], true, 400)
on conflict (tipo) do nothing;

-- ── 7) Identidad: teléfono autorizado → usuario SGC (DL-07) ────────────────
create or replace function sgc.wa_autor_usuario(p_telefono text)
returns uuid
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select wa.usuario_id
  from sgc.whatsapp_autorizados wa
  join sgc.usuarios u on u.id = wa.usuario_id
  where wa.activo and u.activo
    and right(regexp_replace(wa.telefono, '\D', '', 'g'), 10) = right(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), 10)
  limit 1;
$$;
grant execute on function sgc.wa_autor_usuario(text) to authenticated, service_role;

-- ── 8) Asignar/resolver responsable + seguimiento (manual, desde la pantalla) ─
create or replace function sgc.wa_hallazgo_asignar(p_id uuid, p_responsable uuid)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_tipo text;
begin
  if not sgc.puede_operar_submodulo('tecnologia.wa_grupos') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  select tipo into v_tipo from sgc.wa_hallazgos where id = p_id;
  if v_tipo is null then
    raise exception 'Hallazgo no encontrado.';
  end if;
  update sgc.wa_hallazgos
  set responsable_id = p_responsable,
      responsable_origen = 'manual',
      seguimiento = case
        when seguimiento = 'sin' and p_responsable is not null
             and v_tipo in ('tarea','pedido_material','fecha_limite','pregunta_abierta','acuerdo')
          then 'activo'
        else seguimiento
      end,
      seguimiento_desde = case
        when seguimiento_desde is null and p_responsable is not null
             and v_tipo in ('tarea','pedido_material','fecha_limite','pregunta_abierta','acuerdo')
          then now()
        else seguimiento_desde
      end
  where id = p_id;
end;
$$;
grant execute on function sgc.wa_hallazgo_asignar(uuid, uuid) to authenticated;

create or replace function sgc.wa_hallazgo_resolver(p_id uuid, p_motivo text default null)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.wa_grupos') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.wa_hallazgos
  set seguimiento = 'resuelto',
      cierre_motivo = coalesce(p_motivo, 'Marcado manualmente como resuelto.'),
      cerrado_en = now()
  where id = p_id;
end;
$$;
grant execute on function sgc.wa_hallazgo_resolver(uuid, text) to authenticated;

-- ── 9) Convertir hallazgo → acción real (DL-05) ─────────────────────────────
-- 'tarea' crea de verdad en sgc.tareas; otros destinos solo marcan (manual),
-- como ya hacía la pantalla, pero ahora de forma explícita/consistente.
create or replace function sgc.wa_hallazgo_convertir(
  p_id uuid, p_destino text, p_asignado_a uuid default null, p_fecha_limite date default null
)
returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_h sgc.wa_hallazgos%rowtype;
  v_quien uuid;
  v_asignado uuid;
  v_tarea_id uuid;
begin
  if not sgc.puede_operar_submodulo('tecnologia.wa_grupos') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_destino not in ('tarea','requisicion','reunion') then
    raise exception 'Destino inválido: %', p_destino using errcode = '22023';
  end if;

  select * into v_h from sgc.wa_hallazgos where id = p_id for update;
  if v_h.id is null then
    raise exception 'Hallazgo no encontrado.';
  end if;

  -- Idempotente: si ya se convirtió, devuelve la referencia existente sin repetir.
  if v_h.estado = 'convertido' and v_h.convertido_ref_id is not null then
    return v_h.convertido_ref_id;
  end if;

  select u.id into v_quien from sgc.usuarios u where u.id = auth.uid();
  v_asignado := coalesce(p_asignado_a, v_h.responsable_id, v_quien);

  if p_destino = 'tarea' then
    if v_asignado is null then
      raise exception 'Falta a quién asignar la tarea.';
    end if;
    insert into sgc.tareas (titulo, descripcion, asignado_a, asignado_por, proyecto_id, fecha_limite)
    values (
      left(v_h.resumen, 140),
      coalesce(v_h.detalle, v_h.resumen) || E'\n\nDel grupo de WhatsApp "' ||
        coalesce((select nombre from sgc.wa_grupos where jid = v_h.grupo_jid), v_h.grupo_jid) || '".',
      v_asignado,
      coalesce(v_quien, v_asignado),
      v_h.proyecto_id,
      coalesce(p_fecha_limite, v_h.fecha_mencionada)
    )
    returning id into v_tarea_id;

    update sgc.wa_hallazgos
    set estado = 'convertido', convertido_a = 'tarea', convertido_ref_id = v_tarea_id,
        seguimiento = 'resuelto', cierre_motivo = 'convertido_a_tarea', cerrado_en = now()
    where id = p_id;

    return v_tarea_id;
  end if;

  -- requisicion/reunion: sin forma segura de prellenar en esta ronda (F0 lo deja
  -- así a propósito) — se marca manual, la persona crea desde el módulo destino.
  update sgc.wa_hallazgos
  set estado = 'convertido', convertido_a = p_destino
  where id = p_id;
  return null;
end;
$$;
grant execute on function sgc.wa_hallazgo_convertir(uuid, text, uuid, date) to authenticated;

-- ── 10) wa_hallazgos_listar_v2 — con campos de seguimiento (DL3/DL6) ───────
-- Firma nueva (no se toca la v1: Compa/MCP la siguen usando hasta que F7
-- los migre explícitamente).
create or replace function sgc.wa_hallazgos_listar_v2(
  p_grupo_jid text default null, p_tipo text default null, p_estado text default null,
  p_seguimiento text default null, p_responsable uuid default null,
  p_desde date default null, p_hasta date default null, p_limite integer default 30, p_offset integer default 0
) returns table (
  id uuid, grupo_jid text, grupo_nombre text, tipo text, resumen text, detalle text,
  fecha_mencionada date, monto numeric, moneda text, confianza numeric, estado text,
  responsable_id uuid, responsable_nombre text, responsable_origen text,
  seguimiento text, seguimiento_desde timestamptz, recordatorios_enviados integer,
  ultimo_recordatorio_en timestamptz, convertido_a text, convertido_ref_id uuid,
  creado_en timestamptz, total bigint
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select h.id, h.grupo_jid, g.nombre, h.tipo, h.resumen, h.detalle, h.fecha_mencionada,
    h.monto, h.moneda, h.confianza, h.estado,
    h.responsable_id, r.nombre, h.responsable_origen,
    h.seguimiento, h.seguimiento_desde, h.recordatorios_enviados, h.ultimo_recordatorio_en,
    h.convertido_a, h.convertido_ref_id, h.creado_en,
    count(*) over () as total
  from sgc.wa_hallazgos h
  join sgc.wa_grupos g on g.jid = h.grupo_jid
  left join sgc.usuarios r on r.id = h.responsable_id
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and (p_grupo_jid is null or h.grupo_jid = p_grupo_jid)
    and (p_tipo is null or h.tipo = p_tipo)
    and (p_estado is null or h.estado = p_estado)
    and (p_seguimiento is null or h.seguimiento = p_seguimiento)
    and (p_responsable is null or h.responsable_id = p_responsable)
    and (p_desde is null or h.creado_en::date >= p_desde)
    and (p_hasta is null or h.creado_en::date <= p_hasta)
  order by h.creado_en desc
  limit greatest(1, least(coalesce(p_limite,30), 100))
  offset greatest(0, coalesce(p_offset,0));
$$;
grant execute on function sgc.wa_hallazgos_listar_v2(text,text,text,text,uuid,date,date,integer,integer) to authenticated, service_role;

-- ── 11) Lectura propia para Compa (F7) — solo lo que me toca a mí ──────────
create or replace function sgc.wa_mis_pendientes()
returns table (
  id uuid, grupo_nombre text, resumen text, fecha_mencionada date,
  seguimiento text, seguimiento_desde timestamptz, dias_abierto integer
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select h.id, g.nombre, h.resumen, h.fecha_mencionada, h.seguimiento, h.seguimiento_desde,
    case when h.seguimiento_desde is not null
      then extract(day from now() - h.seguimiento_desde)::integer else null end
  from sgc.wa_hallazgos h
  join sgc.wa_grupos g on g.jid = h.grupo_jid
  where h.responsable_id = (select id from sgc.usuarios where id = auth.uid())
    and h.seguimiento in ('activo','vencido','resuelto_probable')
  order by h.seguimiento_desde asc nulls last;
$$;
grant execute on function sgc.wa_mis_pendientes() to authenticated, service_role;

commit;
