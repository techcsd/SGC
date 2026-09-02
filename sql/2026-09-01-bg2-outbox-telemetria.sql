-- =============================================================================
-- PROMPT-28 (BG) FASE 1 — BG2(c/d): Telemetría del outbox atascado.
-- Ronda 19/08-03/09/2026. Aditivo, idempotente, retrocompatible.
--
-- PROBLEMA: un ingeniero tuvo bitácoras REALES atascadas en el outbox de la app
-- desde el 20 y 25-ago por errores de SISTEMA (RLS/constraint), y Xaviel se enteró
-- por un screenshot DOS SEMANAS después. Nadie del lado servidor sabía que había
-- data real sin llegar. Regla de la tanda: "la data real de obra NUNCA se pierde".
--
-- SOLUCIÓN: cuando la app tiene registros atascados por errores de SISTEMA
-- (categoría nueva de BG1 — no es culpa del usuario ni de su dato), los REPORTA a
-- este registro vía `reportar_outbox_atascado` (SECURITY DEFINER: estampa identidad
-- real; no depende de permisos del usuario). Tecnología recibe:
--   · alerta INMEDIATA al ver por primera vez un error de sistema nuevo (dedup_key),
--   · resumen DIARIO si persisten sin resolver (cron, held para Xaviel),
-- y un panel /tecnologia/outbox-atascados con conteos + detalle (tipo, usuario,
-- error, edad, intentos).
--
-- Reutiliza el patrón BE2 (consultas-no-atendidas): tabla RLS es_tecnologia, RPC
-- ingest DEFINER, RPCs de conteo/listado/resolver gateados. La notificación va por
-- la Matriz BF4 (`notificar_modulo('tecnologia', ...)`), tipo administrable.
--
-- Contrato para la app (PROMPT-29 F1): la app llama `reportar_outbox_atascado`
-- cuando un item entra/permanece en categoría 'sistema'. Idempotente por dedup_key
-- (un item reportado N veces NO genera N filas ni N alertas — solo actualiza).
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-01-bg2-outbox-telemetria.sql
-- =============================================================================
begin;

-- ── Tabla: un registro por item atascado del outbox (dedup por dispositivo) ──
create table if not exists sgc.outbox_atascados (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid references sgc.usuarios(id),
  usuario_nombre  text,                        -- snapshot legible
  roles_snapshot  text,                        -- roles al momento (coma-separados)
  dedup_key       text not null,               -- id estable del item en el outbox del cliente
  tipo_op         text not null,               -- bitacora | echada | confirmacion | conduce | conduce_externo | ficha_personal | ...
  categoria       text not null default 'sistema'
                    check (categoria in ('sistema','dato','transitorio')),
  error_kind      text,                        -- SyncErrorKind del cliente (permiso/validacion/...)
  error_code      text,                        -- SQLSTATE (42501, 23514, 22001, ...)
  error_msg       text,                        -- mensaje crudo (para Tecnología)
  intentos        int  not null default 1,
  fotos_count     int  not null default 0,     -- cuántas fotos lleva atascadas (para el rescate)
  edad_horas      int,                          -- antigüedad del item al reportarse
  payload_resumen jsonb not null default '{}'::jsonb, -- resumen chico (NO el payload completo ni las fotos)
  primera_vez     timestamptz not null default now(),
  ultima_vez      timestamptz not null default now(),
  resuelto        boolean not null default false,
  resuelto_por    uuid references sgc.usuarios(id),
  resuelto_en     timestamptz,
  nota            text,
  unique (usuario_id, dedup_key)
);

create index if not exists idx_outbox_atascados_pend
  on sgc.outbox_atascados (resuelto, categoria, ultima_vez desc);
create index if not exists idx_outbox_atascados_tipo
  on sgc.outbox_atascados (tipo_op, ultima_vez desc);

alter table sgc.outbox_atascados enable row level security;

-- Escritura: solo vía el RPC DEFINER (no política de insert/update directa).
-- Lectura + resolución: solo Tecnología (es_tecnologia = admin OR módulo tecnologia).
drop policy if exists outbox_atascados_select_tec on sgc.outbox_atascados;
create policy outbox_atascados_select_tec on sgc.outbox_atascados
  for select to authenticated using (sgc.es_tecnologia());

drop policy if exists outbox_atascados_update_tec on sgc.outbox_atascados;
create policy outbox_atascados_update_tec on sgc.outbox_atascados
  for update to authenticated using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());

-- ── Ingest (lo llama la app con el JWT del usuario) ──────────────────────────
-- DEFINER: estampa auth.uid() + snapshot de roles → el registro no depende de que
-- el usuario tenga permiso de insert (justamente porque está atascado por permiso).
-- Idempotente por (usuario_id, dedup_key): reportar el mismo item N veces solo
-- actualiza intentos/ultima_vez/error_*. Alerta a Tecnología SOLO la primera vez
-- que aparece un error de sistema nuevo (por dedup_key) — no spamea en cada tick.
create or replace function sgc.reportar_outbox_atascado(
  p_dedup_key text,
  p_tipo_op text,
  p_categoria text default 'sistema',
  p_error_kind text default null,
  p_error_code text default null,
  p_error_msg text default null,
  p_intentos int default 1,
  p_fotos_count int default 0,
  p_edad_horas int default null,
  p_payload_resumen jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_nombre text;
  v_roles  text;
  v_cat    text := lower(coalesce(nullif(trim(p_categoria),''),'sistema'));
  v_id     uuid;
  v_new    boolean;
  v_count  int;
begin
  if v_uid is null then return null; end if;
  if coalesce(trim(p_dedup_key),'') = '' or coalesce(trim(p_tipo_op),'') = '' then
    return null;
  end if;
  if v_cat not in ('sistema','dato','transitorio') then v_cat := 'sistema'; end if;

  select u.nombre, nullif(string_agg(distinct r.nombre, ', '), '')
    into v_nombre, v_roles
  from sgc.usuarios u
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where u.id = v_uid
  group by u.nombre;

  insert into sgc.outbox_atascados (
    usuario_id, usuario_nombre, roles_snapshot, dedup_key, tipo_op, categoria,
    error_kind, error_code, error_msg, intentos, fotos_count, edad_horas, payload_resumen
  ) values (
    v_uid, v_nombre, v_roles, trim(p_dedup_key), trim(p_tipo_op), v_cat,
    nullif(p_error_kind,''), nullif(p_error_code,''), left(nullif(p_error_msg,''), 2000),
    greatest(coalesce(p_intentos,1),1), greatest(coalesce(p_fotos_count,0),0),
    p_edad_horas, coalesce(p_payload_resumen,'{}'::jsonb)
  )
  on conflict (usuario_id, dedup_key) do update
    set intentos    = greatest(sgc.outbox_atascados.intentos, excluded.intentos),
        ultima_vez  = now(),
        categoria   = excluded.categoria,
        error_kind  = coalesce(excluded.error_kind, sgc.outbox_atascados.error_kind),
        error_code  = coalesce(excluded.error_code, sgc.outbox_atascados.error_code),
        error_msg   = coalesce(excluded.error_msg,  sgc.outbox_atascados.error_msg),
        fotos_count = greatest(sgc.outbox_atascados.fotos_count, excluded.fotos_count),
        edad_horas  = coalesce(excluded.edad_horas, sgc.outbox_atascados.edad_horas),
        -- reabrir si Tecnología lo había marcado resuelto y el item VOLVIÓ a fallar
        resuelto    = false,
        resuelto_por= null,
        resuelto_en = null
  returning id, (xmax = 0) into v_id, v_new;

  -- Alerta INMEDIATA a Tecnología solo la primera vez que aparece un error de
  -- sistema nuevo (dedup_key). Los de dato/transitorio no alertan (son del usuario
  -- o se auto-reintentan). Best-effort: nunca romper el ingest por la notificación.
  if v_new and v_cat = 'sistema' then
    begin
      select count(*) into v_count
        from sgc.outbox_atascados
       where categoria = 'sistema' and not resuelto;
      perform sgc.notificar_modulo(
        'tecnologia', 'outbox_atascado',
        'Registro atascado en el outbox',
        format('%s de %s tiene "%s" (%s) sin poder enviarse — %s pendiente(s) de sistema en total.',
               initcap(replace(trim(p_tipo_op),'_',' ')),
               coalesce(v_nombre,'un usuario'),
               left(coalesce(p_error_msg,'error de sistema'), 120),
               coalesce(p_error_code,'—'),
               v_count),
        '/tecnologia/outbox-atascados');
    exception when others then null;
    end;
  end if;

  return v_id;
end;
$$;
grant execute on function sgc.reportar_outbox_atascado(text, text, text, text, text, text, int, int, int, jsonb)
  to authenticated, service_role;

-- ── Panel (Tecnología) — conteos ────────────────────────────────────────────
create or replace function sgc.outbox_atascados_conteos()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when sgc.es_tecnologia() then
    jsonb_build_object(
      'total',             count(*),
      'pendientes',        count(*) filter (where not resuelto),
      'sistema',           count(*) filter (where categoria = 'sistema' and not resuelto),
      'dato',              count(*) filter (where categoria = 'dato' and not resuelto),
      'transitorio',       count(*) filter (where categoria = 'transitorio' and not resuelto),
      'usuarios_afectados',count(distinct usuario_id) filter (where not resuelto),
      'fotos_en_riesgo',   coalesce(sum(fotos_count) filter (where not resuelto), 0),
      'mas_viejo_horas',   coalesce((max(extract(epoch from (now() - primera_vez))/3600)
                                     filter (where not resuelto))::int, 0),
      'ultimos_7d',        count(*) filter (where primera_vez >= now() - interval '7 days')
    )
  else jsonb_build_object('error','no_autorizado') end
  from sgc.outbox_atascados;
$$;
grant execute on function sgc.outbox_atascados_conteos() to authenticated, service_role;

-- ── Panel (Tecnología) — listado filtrable ──────────────────────────────────
create or replace function sgc.outbox_atascados_listado(
  p_categoria text default null,
  p_solo_pendientes boolean default false,
  p_limite int default 300
) returns table (
  id uuid, tipo_op text, categoria text, error_kind text, error_code text,
  error_msg text, intentos int, fotos_count int, edad_horas int,
  payload_resumen jsonb, usuario_nombre text, roles_snapshot text,
  primera_vez timestamptz, ultima_vez timestamptz, resuelto boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select o.id, o.tipo_op, o.categoria, o.error_kind, o.error_code,
         o.error_msg, o.intentos, o.fotos_count, o.edad_horas,
         o.payload_resumen, o.usuario_nombre, o.roles_snapshot,
         o.primera_vez, o.ultima_vez, o.resuelto
  from sgc.outbox_atascados o
  where sgc.es_tecnologia()
    and (p_categoria is null or o.categoria = p_categoria)
    and (not p_solo_pendientes or not o.resuelto)
  order by o.resuelto asc, o.primera_vez asc
  limit greatest(1, least(coalesce(p_limite, 300), 1000));
$$;
grant execute on function sgc.outbox_atascados_listado(text, boolean, int)
  to authenticated, service_role;

-- ── Marcar resuelto (Tecnología ya publicó el fix y el usuario reenvió) ──────
create or replace function sgc.outbox_atascado_resolver(
  p_id uuid, p_resuelto boolean default true, p_nota text default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.outbox_atascados
     set resuelto     = coalesce(p_resuelto, true),
         resuelto_por = case when p_resuelto then auth.uid() else null end,
         resuelto_en  = case when p_resuelto then now() else null end,
         nota         = coalesce(nullif(trim(p_nota),''), nota)
   where id = p_id;
end;
$$;
grant execute on function sgc.outbox_atascado_resolver(uuid, boolean, text)
  to authenticated, service_role;

-- ── Resumen DIARIO (cron): si persisten errores de sistema sin resolver, avisa ─
-- a Tecnología con el conteo. Idempotente; no alerta si no hay pendientes.
-- Programar (HELD para Xaviel):
--   select cron.schedule('outbox-atascados-diario','0 12 * * *',  -- 8AM RD (UTC-4)
--     $$ select sgc.outbox_atascados_resumen_diario(); $$);
create or replace function sgc.outbox_atascados_resumen_diario()
returns int
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_count int; v_usuarios int; v_viejo int;
begin
  select count(*), count(distinct usuario_id),
         coalesce(max(extract(epoch from (now()-primera_vez))/3600)::int,0)
    into v_count, v_usuarios, v_viejo
  from sgc.outbox_atascados
  where categoria = 'sistema' and not resuelto;

  if coalesce(v_count,0) > 0 then
    perform sgc.notificar_modulo(
      'tecnologia', 'outbox_atascado',
      'Outbox: registros de sistema aún atascados',
      format('%s registro(s) de %s usuario(s) siguen sin poder enviarse (el más viejo, %s h). Revisa el panel.',
             v_count, v_usuarios, v_viejo),
      '/tecnologia/outbox-atascados');
  end if;
  return coalesce(v_count,0);
end;
$$;
grant execute on function sgc.outbox_atascados_resumen_diario() to service_role;

-- ── Registrar el tipo en el catálogo de notificaciones (administrable BF4b) ──
-- es_operativa = true → el usuario final NO lo silencia (es interno de Tecnología);
-- un admin sí puede regularlo por `notif_regla`. Reproduce el catálogo vigente + añade.
create or replace function sgc.notif_tipos_catalogo()
returns table(tipo text, etiqueta text, es_operativa boolean)
language sql stable as $$
  select * from (values
    ('version_publicada','Nuevas versiones', false),
    ('material_no_catalogado','Material no catalogado', false),
    ('otros_valor','Valores fuera de catálogo', false),
    ('solicitud_movimiento','Solicitudes de movimiento', false),
    ('flota','Avisos de flota', false),
    ('transporte','Transporte y rutas', false),
    ('conduce','Conduces', false),
    ('novedad','Novedades', false),
    ('consumo_anormal','Consumo anómalo', true),
    ('ruta_asignada','Ruta asignada', true),
    ('conduce_por_confirmar','Conduce por confirmar', true),
    ('outbox_atascado','Registros atascados (outbox)', true)
  ) as t(tipo, etiqueta, es_operativa);
$$;
grant execute on function sgc.notif_tipos_catalogo() to authenticated;

commit;
