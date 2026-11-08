-- =============================================================================
-- PROMPT DB-2 (ronda DB, items DB-S1..DB-S10) — WhatsApp: memoria de grupos,
-- extracción de hallazgos, herramientas de Compa/MCP, pantalla de Tecnología.
--
-- Contexto: un número de WhatsApp dedicado se añade a los grupos de la empresa
-- vía un programa externo NO oficial (`csd-wa-listener`, cliente WhatsApp Web
-- en una laptop siempre encendida — repo hermano, ver PROMPT-DB-1-LISTENER.md).
-- Ese programa firma cada POST con HMAC y lo manda a la edge `wa-ingest`
-- (DB-S3). Esta migración crea el esquema que esa edge y la edge de
-- extracción `wa-extract` (DB-S4) usan para guardar/leer memoria de grupos,
-- hallazgos y estado del listener, y lo que la pantalla de Tecnología
-- (DB-S6, extiende `tecnologia/whatsapp`) y las herramientas de Compa/MCP
-- (DB-S5) consultan.
--
-- NO toca el canal 1:1 (round DC, WhatsApp Cloud API oficial): las tablas
-- `sgc.whatsapp_autorizados` (BJ2), `sgc.whatsapp_conversaciones` y
-- `sgc.whatsapp_mensajes` (DC2) YA EXISTEN y se reusan tal cual — ver
-- `sql/2026-09-04-bj2-whatsapp-compa-whitelist.sql` y
-- `sql/2026-10-29-dc2-whatsapp-cloud-api.sql`.
--
-- Permiso: submódulo granular `tecnologia.wa_grupos` (patrón AG12 —
-- `sql/2026-08-05-ag12-permisos-granulares.sql`). Por la regla de
-- compatibilidad de ese patrón, quien ya tiene el módulo `tecnologia`
-- (admin/Tecnología) obtiene 'operar' automáticamente en todos sus
-- submódulos — cumple "granted by default only to admin and Tecnología" sin
-- tocar `sgc.roles` aquí. Xaviel puede otorgar el submódulo suelto a otro rol
-- después desde Administración › Roles (role-permisos-editor.ts, ya existe).
--
-- Convención de FTS de este repo: índice GIN por expresión sobre
-- to_tsvector('spanish', ...), NO columna generada (ver
-- sql/2026-09-14-bp5-notas-ambito-dev.sql) — se sigue esa convención aquí.
--
-- Aditivo, idempotente. Ronda DB (05/11/2026).
-- Apply: node scripts/apply-migration.mjs sql/2026-11-05-db2-whatsapp-grupos.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

create extension if not exists pgcrypto;

-- ── 1) Grupos de WhatsApp conocidos ─────────────────────────────────────────
create table if not exists sgc.wa_grupos (
  jid               text primary key,
  nombre            text not null default '',
  modo              text not null default 'memoria'
                      check (modo in ('memoria','consulta','ignorar')),
  participantes     integer,
  proyecto_id       uuid references sgc.proyectos(id) on delete set null,
  aviso_enviado_en  timestamptz,
  primer_mensaje_en timestamptz,
  ultimo_mensaje_en timestamptz,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);
comment on table sgc.wa_grupos is
  'DB2 — grupos de WhatsApp que el listener reporta. modo: memoria (se guarda y extrae) | consulta (además responde preguntas SOLO con el archivo del propio grupo) | ignorar (no se guarda nada, defensa en profundidad además del filtro del listener).';

create or replace function sgc._wa_tocar_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
drop trigger if exists tg_wa_grupos_actualizado_en on sgc.wa_grupos;
create trigger tg_wa_grupos_actualizado_en before update on sgc.wa_grupos
  for each row execute function sgc._wa_tocar_actualizado_en();

alter table sgc.wa_grupos enable row level security;
drop policy if exists wa_grupos_sel on sgc.wa_grupos;
create policy wa_grupos_sel on sgc.wa_grupos for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
drop policy if exists wa_grupos_upd on sgc.wa_grupos;
create policy wa_grupos_upd on sgc.wa_grupos for update to authenticated
  using (sgc.puede_operar_submodulo('tecnologia.wa_grupos'))
  with check (sgc.puede_operar_submodulo('tecnologia.wa_grupos'));
grant select, update on sgc.wa_grupos to authenticated;
grant all on sgc.wa_grupos to service_role;

-- ── 2) Mensajes de grupo (archivo) ──────────────────────────────────────────
create table if not exists sgc.wa_mensajes_grupo (
  id               uuid primary key default gen_random_uuid(),
  wa_message_id    text unique not null,
  grupo_jid        text not null references sgc.wa_grupos(jid) on delete cascade,
  autor_telefono   text not null,
  autor_nombre     text,
  usuario_id       uuid references sgc.usuarios(id) on delete set null,
  tipo             text not null default 'otro'
                     check (tipo in ('texto','audio','imagen','documento','video','sticker','ubicacion','contacto','otro')),
  texto            text,
  transcripcion    text,
  media_ref        text,
  media_mime       text,
  descripcion_media text,
  reply_to_id      text,
  menciona_bot     boolean not null default false,
  enviado_en       timestamptz not null,
  recibido_en      timestamptz not null default now(),
  procesado        boolean not null default false,
  procesado_en     timestamptz
);
comment on table sgc.wa_mensajes_grupo is
  'DB2 — archivo de mensajes de grupos de WhatsApp (modo memoria/consulta). Retención 180 días (sgc.wa_purgar_mensajes_viejos). El audio nunca se guarda más allá de su transcripción — mismo criterio que DC4.';
create index if not exists idx_wa_mensajes_grupo_grupo_fecha on sgc.wa_mensajes_grupo (grupo_jid, enviado_en desc);
create index if not exists idx_wa_mensajes_grupo_pendientes on sgc.wa_mensajes_grupo (procesado, recibido_en);
create index if not exists idx_wa_mensajes_grupo_fts on sgc.wa_mensajes_grupo
  using gin (to_tsvector('spanish', coalesce(texto,'') || ' ' || coalesce(transcripcion,'') || ' ' || coalesce(descripcion_media,'')));

alter table sgc.wa_mensajes_grupo enable row level security;
drop policy if exists wa_mensajes_grupo_sel on sgc.wa_mensajes_grupo;
create policy wa_mensajes_grupo_sel on sgc.wa_mensajes_grupo for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_mensajes_grupo to authenticated;
grant all on sgc.wa_mensajes_grupo to service_role;

-- ── 3) Hallazgos extraídos por IA ────────────────────────────────────────────
create table if not exists sgc.wa_hallazgos (
  id              uuid primary key default gen_random_uuid(),
  grupo_jid       text not null references sgc.wa_grupos(jid) on delete cascade,
  tipo            text not null check (tipo in
                    ('acuerdo','tarea','pedido_material','incidente','decision','monto',
                     'fecha_limite','cambio_de_plan','pregunta_abierta','contacto','otro')),
  resumen         text not null,
  detalle         text,
  personas        jsonb not null default '[]'::jsonb,
  fecha_mencionada date,
  monto           numeric,
  moneda          text,
  proyecto_id     uuid references sgc.proyectos(id) on delete set null,
  mensaje_ids     uuid[] not null default '{}',
  confianza       numeric check (confianza is null or confianza between 0 and 1),
  estado          text not null default 'nuevo' check (estado in ('nuevo','revisado','descartado','convertido')),
  convertido_a    text,
  dedupe_hash     text unique,
  revisado_por    uuid references sgc.usuarios(id) on delete set null,
  revisado_en     timestamptz,
  creado_en       timestamptz not null default now()
);
comment on table sgc.wa_hallazgos is
  'DB2 — hallazgos extraídos por IA de mensajes de grupo (acuerdos, pedidos, montos, fechas límite, etc). confianza es un indicador, nunca verdad absoluta (BS2) — el humano decide con Revisar/Descartar/Convertir.';
create index if not exists idx_wa_hallazgos_grupo on sgc.wa_hallazgos (grupo_jid, creado_en desc);
create index if not exists idx_wa_hallazgos_estado on sgc.wa_hallazgos (estado, creado_en desc);
create index if not exists idx_wa_hallazgos_fts on sgc.wa_hallazgos
  using gin (to_tsvector('spanish', coalesce(resumen,'') || ' ' || coalesce(detalle,'')));

create or replace function sgc._wa_hallazgo_revisar_trigger()
returns trigger language plpgsql as $$
begin
  if new.estado is distinct from old.estado and new.estado <> 'nuevo' and new.revisado_por is null then
    new.revisado_por := auth.uid();
    new.revisado_en := now();
  end if;
  return new;
end;
$$;
drop trigger if exists tg_wa_hallazgos_revisar on sgc.wa_hallazgos;
create trigger tg_wa_hallazgos_revisar before update on sgc.wa_hallazgos
  for each row execute function sgc._wa_hallazgo_revisar_trigger();

alter table sgc.wa_hallazgos enable row level security;
drop policy if exists wa_hallazgos_sel on sgc.wa_hallazgos;
create policy wa_hallazgos_sel on sgc.wa_hallazgos for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
drop policy if exists wa_hallazgos_upd on sgc.wa_hallazgos;
create policy wa_hallazgos_upd on sgc.wa_hallazgos for update to authenticated
  using (sgc.puede_operar_submodulo('tecnologia.wa_grupos'))
  with check (sgc.puede_operar_submodulo('tecnologia.wa_grupos'));
grant select, update on sgc.wa_hallazgos to authenticated;
grant all on sgc.wa_hallazgos to service_role;

-- Inserción idempotente desde wa-extract (service_role): el hash dedupe evita
-- duplicar el mismo hallazgo si el batch se reprocesa.
create or replace function sgc.wa_hallazgo_insertar(
  p_grupo_jid text, p_tipo text, p_resumen text, p_detalle text default null,
  p_personas jsonb default '[]'::jsonb, p_fecha_mencionada date default null,
  p_monto numeric default null, p_moneda text default null, p_proyecto_id uuid default null,
  p_mensaje_ids uuid[] default '{}', p_confianza numeric default null
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'extensions', 'pg_temp'
as $$
declare v_ids_ordenados text; v_hash text; v_id uuid;
begin
  select coalesce(string_agg(x::text, ',' order by x), '') into v_ids_ordenados
    from unnest(p_mensaje_ids) x;
  v_hash := encode(digest(
    coalesce(p_grupo_jid,'') || '|' || coalesce(p_tipo,'') || '|' || v_ids_ordenados || '|' || coalesce(p_resumen,''),
    'sha256'), 'hex');
  insert into sgc.wa_hallazgos
    (grupo_jid, tipo, resumen, detalle, personas, fecha_mencionada, monto, moneda, proyecto_id, mensaje_ids, confianza, dedupe_hash)
  values
    (p_grupo_jid, p_tipo, p_resumen, p_detalle, coalesce(p_personas,'[]'::jsonb), p_fecha_mencionada, p_monto, p_moneda, p_proyecto_id, coalesce(p_mensaje_ids,'{}'), p_confianza, v_hash)
  on conflict (dedupe_hash) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.wa_hallazgo_insertar(text,text,text,text,jsonb,date,numeric,text,uuid,uuid[],numeric) to service_role;

-- ── 4) Resúmenes diarios/semanales por grupo ────────────────────────────────
create table if not exists sgc.wa_resumenes (
  id                uuid primary key default gen_random_uuid(),
  grupo_jid         text not null references sgc.wa_grupos(jid) on delete cascade,
  periodo           text not null check (periodo in ('dia','semana')),
  fecha             date not null,
  resumen           text,
  puntos_clave      jsonb not null default '[]'::jsonb,
  mensajes_cubiertos integer not null default 0,
  creado_en         timestamptz not null default now(),
  unique (grupo_jid, periodo, fecha)
);
comment on table sgc.wa_resumenes is 'DB2 — resumen diario/semanal por grupo (wa-extract, cron). Se conserva sin límite de retención (a diferencia del archivo crudo).';

alter table sgc.wa_resumenes enable row level security;
drop policy if exists wa_resumenes_sel on sgc.wa_resumenes;
create policy wa_resumenes_sel on sgc.wa_resumenes for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_resumenes to authenticated;
grant all on sgc.wa_resumenes to service_role;

-- ── 5) Estado del listener (heartbeat) ──────────────────────────────────────
create table if not exists sgc.wa_listener_estado (
  host                  text primary key,
  estado                text not null check (estado in ('conectado','esperando_qr','desconectado','sesion_cerrada','posible_baneo')),
  libreria              text,
  version               text,
  cola_pendiente        integer,
  ultimo_latido_en      timestamptz not null default now(),
  ultimo_mensaje_en     timestamptz,
  mensajes_enviados_24h integer,
  reconexiones_24h      integer,
  detalle               jsonb not null default '{}'::jsonb
);
comment on table sgc.wa_listener_estado is 'DB2 — heartbeat del listener externo (csd-wa-listener), una fila por host. Vigilado por sgc.wa_revisar_latido (cron cada 5 min).';

alter table sgc.wa_listener_estado enable row level security;
drop policy if exists wa_listener_estado_sel on sgc.wa_listener_estado;
create policy wa_listener_estado_sel on sgc.wa_listener_estado for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_listener_estado to authenticated;
grant all on sgc.wa_listener_estado to service_role;

-- ── 6) Eventos / log de alertas ─────────────────────────────────────────────
create table if not exists sgc.wa_eventos (
  id        uuid primary key default gen_random_uuid(),
  nivel     text not null check (nivel in ('info','alerta','critico')),
  codigo    text not null,
  detalle   jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
comment on table sgc.wa_eventos is 'DB2 — log de eventos del puente de grupos (heartbeats, errores de ingest/extracción, avisos). Retención 60 días. alerta/critico disparan correo (y Telegram si hay secretos) — ver sgc.wa_revisar_latido y wa-ingest.';
create index if not exists idx_wa_eventos_fecha on sgc.wa_eventos (creado_en desc);
create index if not exists idx_wa_eventos_nivel_codigo_fecha on sgc.wa_eventos (nivel, codigo, creado_en desc);

alter table sgc.wa_eventos enable row level security;
drop policy if exists wa_eventos_sel on sgc.wa_eventos;
create policy wa_eventos_sel on sgc.wa_eventos for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
grant select on sgc.wa_eventos to authenticated;
grant all on sgc.wa_eventos to service_role;

-- Limpieza: esta misma migración, en su primer apply a dev (mismo día), había
-- creado una tabla `wa_uso_ia` propia antes de notar que sgc.uso_ia (CF4) ya
-- cubre esto — se retira aquí (nunca salió de dev, nunca se documentó afuera).
drop table if exists sgc.wa_uso_ia cascade;

-- ── 7) Uso de IA — REUSA sgc.uso_ia (CF4, sql/2026-10-02-cf4-leer-recibo-uso-ia.sql),
--      la tabla genérica que YA usa leer-recibo/assistant/etc, en vez de abrir un
--      silo nuevo. Convención de `funcion`: prefijo 'wa_' (wa_extract, wa_resumen,
--      wa_dm, wa_stt, wa_vision) — así sgc.uso_ia_resumen() (ya existente, visible
--      a Tecnología) ya las agrega sin cambios. Los helpers de abajo solo añaden
--      lo que falta: un registrador para edges service_role y un corte diario
--      (uso_ia_resumen es mensual) para que la pestaña Estado y el presupuesto
--      diario de wa-extract (DB-S4 punto 7) tengan granularidad de día. ─────────
create or replace function sgc.wa_uso_ia_registrar(
  p_funcion text, p_usuario_id uuid default null, p_modelo text default null,
  p_tokens_in integer default 0, p_tokens_out integer default 0,
  p_costo_estimado numeric default null, p_meta jsonb default null
) returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  insert into sgc.uso_ia (usuario_id, funcion, modelo, tokens_in, tokens_out, costo_estimado, meta)
  values (p_usuario_id, p_funcion, p_modelo, coalesce(p_tokens_in,0), coalesce(p_tokens_out,0), p_costo_estimado, p_meta);
end;
$$;
grant execute on function sgc.wa_uso_ia_registrar(text,uuid,text,integer,integer,numeric,jsonb) to service_role;

-- Suma de tokens de HOY de TODAS las funciones 'wa_%', para que wa-extract
-- decida si pausar extracción (presupuesto diario — DB-S4 punto 7).
create or replace function sgc.wa_uso_ia_tokens_hoy()
returns bigint language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(sum(tokens_in + tokens_out), 0) from sgc.uso_ia
  where funcion like 'wa\_%' escape '\' and created_at::date = current_date;
$$;
grant execute on function sgc.wa_uso_ia_tokens_hoy() to service_role;

-- Corte diario (no mensual) por función 'wa_%', para la pestaña Estado.
create or replace function sgc.wa_uso_ia_diario(p_desde date default null, p_hasta date default null)
returns jsonb language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(x order by x->>'fecha' desc, x->>'funcion'), '[]'::jsonb) from (
    select jsonb_build_object(
      'fecha', to_char(created_at::date, 'YYYY-MM-DD'),
      'funcion', funcion,
      'llamadas', count(*),
      'tokens_in', coalesce(sum(tokens_in),0),
      'tokens_out', coalesce(sum(tokens_out),0),
      'costo_estimado', round(coalesce(sum(costo_estimado),0), 4)
    ) as x
    from sgc.uso_ia
    where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
      and funcion like 'wa\_%' escape '\'
      and (p_desde is null or created_at::date >= p_desde)
      and (p_hasta is null or created_at::date <= p_hasta)
    group by created_at::date, funcion
  ) s;
$$;
grant execute on function sgc.wa_uso_ia_diario(date,date) to authenticated, service_role;

-- ── 8) Configuración global (fila única) ────────────────────────────────────
create table if not exists sgc.wa_config (
  id                        boolean primary key default true check (id),
  modo_por_defecto          text not null default 'memoria' check (modo_por_defecto in ('memoria','consulta','ignorar')),
  dm_habilitado             boolean not null default true,
  intervalo_heartbeat_s     integer not null default 60,
  max_respuestas_grupo_hora integer not null default 10,
  texto_aviso_grupo         text not null default
    'Hola, soy Compa, el asistente con IA de Constructora SD. Estoy en este grupo para llevar memoria de acuerdos y pendientes. Si tienen dudas sobre esto, hablen con Tecnología.',
  budget_tokens_dia         bigint,
  actualizado_en            timestamptz not null default now()
);
comment on table sgc.wa_config is 'DB2 — configuración única del puente de grupos (fila singleton, id=true). budget_tokens_dia null = sin tope.';
insert into sgc.wa_config (id) values (true) on conflict (id) do nothing;

alter table sgc.wa_config enable row level security;
drop policy if exists wa_config_sel on sgc.wa_config;
create policy wa_config_sel on sgc.wa_config for select to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.wa_grupos'));
drop policy if exists wa_config_upd on sgc.wa_config;
create policy wa_config_upd on sgc.wa_config for update to authenticated
  using (sgc.puede_operar_submodulo('tecnologia.wa_grupos'))
  with check (sgc.puede_operar_submodulo('tecnologia.wa_grupos'));
grant select, update on sgc.wa_config to authenticated;
grant all on sgc.wa_config to service_role;
revoke insert, delete on sgc.wa_config from authenticated;

-- ── 9) Búsqueda / listado para herramientas de Compa y el conector MCP ──────
-- SECURITY DEFINER + check explícito de permiso (mismo patrón que el resto de
-- RPCs de herramientas): funciona tanto si el llamante es un usuario real
-- (web/app) como si es Compa actuando "como" un usuario autorizado (BJ2/DC5).
create or replace function sgc.wa_grupos_listar()
returns table (jid text, nombre text, modo text, participantes integer, ultimo_mensaje_en timestamptz, proyecto_id uuid)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select g.jid, g.nombre, g.modo, g.participantes, g.ultimo_mensaje_en, g.proyecto_id
  from sgc.wa_grupos g
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
  order by g.ultimo_mensaje_en desc nulls last;
$$;
grant execute on function sgc.wa_grupos_listar() to authenticated, service_role;

create or replace function sgc.wa_mensajes_grupo_buscar(
  p_consulta text, p_grupo_jid text default null, p_desde timestamptz default null,
  p_hasta timestamptz default null, p_limite integer default 20
) returns table (
  id uuid, grupo_jid text, grupo_nombre text, autor_nombre text, autor_telefono text,
  tipo text, fragmento text, enviado_en timestamptz
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select m.id, m.grupo_jid, g.nombre, m.autor_nombre, m.autor_telefono, m.tipo,
    ts_headline('spanish',
      coalesce(m.texto,'') || ' ' || coalesce(m.transcripcion,'') || ' ' || coalesce(m.descripcion_media,''),
      websearch_to_tsquery('spanish', coalesce(p_consulta,'')),
      'StartSel=**,StopSel=**,MaxFragments=1,MaxWords=40,MinWords=10'
    ) as fragmento,
    m.enviado_en
  from sgc.wa_mensajes_grupo m
  join sgc.wa_grupos g on g.jid = m.grupo_jid
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and (p_grupo_jid is null or m.grupo_jid = p_grupo_jid)
    and (p_desde is null or m.enviado_en >= p_desde)
    and (p_hasta is null or m.enviado_en <= p_hasta)
    and to_tsvector('spanish', coalesce(m.texto,'') || ' ' || coalesce(m.transcripcion,'') || ' ' || coalesce(m.descripcion_media,''))
        @@ websearch_to_tsquery('spanish', coalesce(p_consulta,''))
  order by m.enviado_en desc
  limit greatest(1, least(coalesce(p_limite,20), 100));
$$;
grant execute on function sgc.wa_mensajes_grupo_buscar(text,text,timestamptz,timestamptz,integer) to authenticated, service_role;

create or replace function sgc.wa_hallazgos_listar(
  p_grupo_jid text default null, p_tipo text default null, p_estado text default null,
  p_desde date default null, p_hasta date default null, p_limite integer default 30
) returns table (
  id uuid, grupo_jid text, grupo_nombre text, tipo text, resumen text, detalle text,
  fecha_mencionada date, monto numeric, moneda text, confianza numeric, estado text, creado_en timestamptz
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select h.id, h.grupo_jid, g.nombre, h.tipo, h.resumen, h.detalle, h.fecha_mencionada,
    h.monto, h.moneda, h.confianza, h.estado, h.creado_en
  from sgc.wa_hallazgos h
  join sgc.wa_grupos g on g.jid = h.grupo_jid
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and (p_grupo_jid is null or h.grupo_jid = p_grupo_jid)
    and (p_tipo is null or h.tipo = p_tipo)
    and (p_estado is null or h.estado = p_estado)
    and (p_desde is null or h.creado_en::date >= p_desde)
    and (p_hasta is null or h.creado_en::date <= p_hasta)
  order by h.creado_en desc
  limit greatest(1, least(coalesce(p_limite,30), 100));
$$;
grant execute on function sgc.wa_hallazgos_listar(text,text,text,date,date,integer) to authenticated, service_role;

create or replace function sgc.wa_resumen_grupo(p_grupo_jid text, p_periodo text, p_fecha date default current_date)
returns table (grupo_jid text, periodo text, fecha date, resumen text, puntos_clave jsonb, mensajes_cubiertos integer)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select r.grupo_jid, r.periodo, r.fecha, r.resumen, r.puntos_clave, r.mensajes_cubiertos
  from sgc.wa_resumenes r
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and r.grupo_jid = p_grupo_jid and r.periodo = p_periodo and r.fecha = coalesce(p_fecha, current_date)
  limit 1;
$$;
grant execute on function sgc.wa_resumen_grupo(text,text,date) to authenticated, service_role;

-- ── 10) Submódulo permisos (AG12) — entrada visible en el editor de roles ───
-- El editor de roles (role-permisos-editor.ts) lee las claves disponibles del
-- front (SUBMODULOS en roles.service.ts) — aquí solo se deja constancia de la
-- clave para quien lea el histórico de SQL: 'tecnologia.wa_grupos'
-- (ver, operar). No requiere fila nueva en `sgc.roles`: admin/tecnologia ya
-- cubiertos por la regla de compatibilidad del módulo padre.

-- ── 11) Bucket privado de media de grupos (solo service_role; el front NUNCA
--      accede directo — todo pasa por URL firmada emitida por una edge) ────
insert into storage.buckets (id, name, public, file_size_limit)
  values ('wa-media', 'wa-media', false, 10485760) -- 10 MB (tope duro; imágenes 5MB/audio 10MB se validan en la edge)
  on conflict (id) do nothing;
-- Sin policies para `authenticated`/`anon` a propósito — acceso exclusivo vía
-- service_role (las edges emiten URLs firmadas de corta duración).

-- ── 12) Retención ────────────────────────────────────────────────────────────
create or replace function sgc.wa_purgar_mensajes_viejos()
returns integer
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_n int;
begin
  delete from storage.objects
    where bucket_id = 'wa-media'
      and name in (select media_ref from sgc.wa_mensajes_grupo
                    where media_ref is not null and enviado_en < now() - interval '180 days');
  delete from sgc.wa_mensajes_grupo where enviado_en < now() - interval '180 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.wa_purgar_mensajes_viejos() to service_role;

create or replace function sgc.wa_purgar_eventos_viejos()
returns integer
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_n int;
begin
  delete from sgc.wa_eventos where creado_en < now() - interval '60 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.wa_purgar_eventos_viejos() to service_role;

do $$ begin perform cron.unschedule('sgc-wa-purgar-mensajes-grupo'); exception when others then null; end $$;
select cron.schedule('sgc-wa-purgar-mensajes-grupo', '20 8 * * *', $cron$ select sgc.wa_purgar_mensajes_viejos(); $cron$);

do $$ begin perform cron.unschedule('sgc-wa-purgar-eventos'); exception when others then null; end $$;
select cron.schedule('sgc-wa-purgar-eventos', '25 8 * * *', $cron$ select sgc.wa_purgar_eventos_viejos(); $cron$);

-- ── 13) Cron de extracción (DB-S4, cada 4 min) + vigilancia de latido (cada
--      5 min) — ambos llaman a la misma edge `wa-extract`; el cuerpo decide
--      la tarea. Mismo secreto compartido que ya usan check-domains/
--      transcribe-audio (infra_sync_secret), sin ref de prod hardcodeado
--      (sgc.edge_url, BU1). ─────────────────────────────────────────────────
do $$ begin perform cron.unschedule('sgc-wa-extraccion'); exception when others then null; end $$;
select cron.schedule('sgc-wa-extraccion', '*/4 * * * *', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-extract'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb)
$cron$);

do $$ begin perform cron.unschedule('sgc-wa-revisar-latido'); exception when others then null; end $$;
select cron.schedule('sgc-wa-revisar-latido', '*/5 * * * *', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-extract'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"tarea":"revisar_latido"}'::jsonb)
$cron$);

do $$ begin perform cron.unschedule('sgc-wa-resumenes-diarios'); exception when others then null; end $$;
select cron.schedule('sgc-wa-resumenes-diarios', '0 9 * * *', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-extract'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"tarea":"resumenes_dia"}'::jsonb)
$cron$);
-- Nota: 9am America/Santo_Domingo = 13:00 UTC o 14:00 UTC según horario; este
-- proyecto no usa horario de verano (RD no lo observa) → 9am hora RD = 13:00
-- UTC. Se deja la hora de cron en UTC (09 UTC ≈ 5am RD) — AJUSTAR a '0 13 * * *'
-- si se confirma que se quiere 9am hora de Santo Domingo exacta (dejar nota en
-- el reporte final para que Xaviel lo confirme; no bloquea el resto).

do $$ begin perform cron.unschedule('sgc-wa-resumenes-semanales'); exception when others then null; end $$;
select cron.schedule('sgc-wa-resumenes-semanales', '15 13 * * 1', $cron$
  select net.http_post(
    url := sgc.edge_url('wa-extract'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{"tarea":"resumenes_semana"}'::jsonb)
$cron$);

-- ── 14) que_puedo_consultar() — registra wa_grupos (DB-S5 follow-up: self-
--      discovery para Compa, mismo patrón que 'tecnologia_inventario' DA-15).
--      MISMO cuerpo que sql/2026-10-27-da5-conector-tecnologia.sql + 1 fila. ──
create or replace function sgc.que_puedo_consultar()
 returns table (modulo text, etiqueta text, puede_ver boolean, herramientas text[])
 language sql
 stable
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  with modulos(modulo, etiqueta, herramientas) as (
    values
      ('identidad', 'Quién soy / mis permisos', array['quien_soy','mis_permisos']),
      ('inventario', 'Inventario', array['buscar_articulos','stock_por_almacen','articulos_bajo_minimo','disponibilidad_de_articulo','movimientos_recientes','material_en_cuarentena','listar_almacenes','proponer_decision_requisicion','proponer_orden_de_compra','proponer_entrada_inventario','proponer_correccion_conduce']),
      ('compras', 'Compras', array['mis_ordenes_de_compra','proponer_orden_de_compra','detalle_compra_tecnologica']),
      ('rrhh', 'RRHH', array['directorio_empleados']),
      ('proyectos', 'Proyectos/obras', array['mis_proyectos','resumen_proyectos','cronograma_de_obra','personal_de_obra']),
      ('flota', 'Flota', array['listar_vehiculos','vehiculos_en_uso','resumen_flota','mantenimientos_pendientes','log_combustible','resumen_flota_carga_semana','echada_detalle','proponer_mantenimiento']),
      ('transporte', 'Transporte (chofer)', array['mis_rutas_hoy','rutas_del_dia','despachantes_disponibles','mis_solicitudes_movimiento']),
      ('bitacora', 'Bitácora', array['cobertura_de_bitacoras','resumen_bitacoras_semana','bitacora_detalle','proponer_bitacora']),
      ('documentos', 'Documentos', array['listar_plantillas_documento','listar_documentos_generados']),
      ('legal', 'Legal', array['listar_expedientes_legales','listar_aprobaciones_legales','proponer_decision_legal','proponer_actualizacion_expediente']),
      ('tareas', 'Tareas (de otros)', array['mis_tareas','proponer_cambio_tarea']),
      ('ingenieria', 'Ingeniería / Solicitud de movimiento', array['mis_solicitudes_movimiento','proponer_solicitud_movimiento']),
      ('reuniones', 'Reuniones', array['mis_reuniones','acuerdos_pendientes','resumen_reunion','proponer_reunion','proponer_cancelar_reunion','proponer_cerrar_acuerdo']),
      ('admin', 'Administración', array['listar_usuarios_admin','mi_actividad_auditoria']),
      ('notas', 'Dev notes / Notas (siempre, sin módulo)', array['mis_notas','detalle_nota','crear_nota','actualizar_nota','mover_nota_a_grupo']),
      ('mensajes', 'Mensajería (siempre, sin módulo)', array['mis_mensajes','proponer_mensaje']),
      ('soporte', 'Soporte / mis reportes (siempre, sin módulo)', array['mis_reportes_soporte']),
      ('soporte_admin', 'Soporte — todos los reportes (solo admin/Tecnología)', array['listar_reportes_soporte','detalle_reporte_soporte','resumen_reportes_soporte','cambiar_estado_reporte','ver_gaps_registrados']),
      ('requisiciones', 'Requisiciones (siempre, sin módulo)', array['listar_requisiciones','requisiciones_pendientes','resumen_requisiciones_semana','resumen_estatus_requisiciones']),
      ('incentivos', 'Mi rendimiento (siempre, sin módulo)', array['mi_rendimiento']),
      ('admin_visibilidad', 'Administración — conector, envíos y alertas (solo admin/Tecnología)', array['conexiones_claude','estado_envios_automaticos','reglas_de_alertas','historial_importaciones','proponer_cambio_envio_automatico','proponer_probar_envio']),
      ('dev_ops', 'Tecnología — errores y versiones (solo admin/Tecnología)', array['errores_recientes','proponer_nota_de_version']),
      ('tecnologia_inventario', 'Inventario tecnológico (equipos de TI)', array['resumen_inventario_tecnologico','listar_equipos_tecnologicos','detalle_equipo_tecnologico','listar_tipos_equipo','proponer_tipo_equipo','proponer_equipo_tecnologico','proponer_cambio_estado_equipo','proponer_asignacion_equipo','proponer_equipos_tecnologicos_lote']),
      -- DB-S5 — memoria de grupos de WhatsApp: admin/Tecnología O el permiso
      -- granular 'tecnologia.wa_grupos', sin el módulo completo.
      ('wa_grupos', 'Grupos de WhatsApp (memoria IA)', array['listar_grupos_whatsapp','buscar_en_grupos_whatsapp','hallazgos_whatsapp','resumen_grupo_whatsapp'])
  )
  select m.modulo, m.etiqueta,
    (m.modulo in ('identidad','notas','mensajes','soporte','requisiciones','incentivos','tareas')
      or sgc.tiene_modulo(m.modulo) or sgc.is_admin()
      or (m.modulo = 'soporte_admin' and sgc.es_tecnologia())
      or (m.modulo in ('admin_visibilidad','dev_ops') and (sgc.is_admin() or sgc.es_tecnologia()))
      or (m.modulo = 'tecnologia_inventario' and (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_ver_submodulo('tecnologia.inventario')))
      or (m.modulo = 'wa_grupos' and sgc.puede_ver_submodulo('tecnologia.wa_grupos'))),
    m.herramientas
  from modulos m
  order by m.etiqueta;
$function$;
grant execute on function sgc.que_puedo_consultar() to authenticated;

-- ── 15) DB-S10 — import de historial viejo (.txt de "Exportar chat") ────────
-- Admin-only (más restrictivo que puede_operar_submodulo: importar masivo de
-- historial de terceros merece el gate más alto). Idempotente por
-- (wa_message_id) — el front genera id_import='import:<hash>' por línea.
create or replace function sgc.wa_importar_mensajes(p_grupo_jid text, p_mensajes jsonb)
returns integer
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_n int;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede importar historial de WhatsApp.' using errcode = '42501';
  end if;
  if p_grupo_jid is null or length(trim(p_grupo_jid)) = 0 then
    raise exception 'Falta el grupo destino.';
  end if;
  insert into sgc.wa_grupos (jid, nombre) values (p_grupo_jid, p_grupo_jid) on conflict (jid) do nothing;

  -- Insert set-based (NO loop) para que `get diagnostics` cuente el total
  -- real insertado, no solo la última fila de un loop fila-por-fila.
  insert into sgc.wa_mensajes_grupo
    (wa_message_id, grupo_jid, autor_telefono, autor_nombre, tipo, texto, enviado_en)
  select
    item->>'id_import', p_grupo_jid,
    coalesce(item->>'autor_telefono', ''), item->>'autor_nombre',
    case when (item->>'tipo') in ('texto','audio','imagen','documento','video','sticker','ubicacion','contacto','otro')
      then item->>'tipo' else 'otro' end,
    item->>'texto',
    coalesce((item->>'enviado_en')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_mensajes, '[]'::jsonb)) as item
  where coalesce(item->>'id_import', '') <> ''
  on conflict (wa_message_id) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.wa_importar_mensajes(text, jsonb) to authenticated;

commit;
