-- ============================================================================
-- CR1 — Conectar el SGC con Claude Desktop (MCP + OAuth de Supabase).
-- FASE 2: tablas de borradores/auditoría del conector, RPCs, parámetros, y el
-- parche de `fn_auditoria()` para que las escrituras hechas con un token OAuth
-- (client_id presente) queden etiquetadas `origen='claude'`.
--
-- Todo aditivo (regla 18: dev primero). `fn_auditoria()` se reemplaza SOBRE LA
-- DEFINICIÓN VIVA DE PROD (verificada hoy por `pg_get_functiondef`, idéntica a
-- sql/2026-10-16-cq3-auditoria-contexto.sql) — regla 19: mismo cuerpo, solo se
-- le antepone la detección de `client_id` antes del header `x-sgc-client`.
-- ============================================================================

begin;

-- ── 1) sgc.claude_borradores — "nada se crea desde Claude" (§B3) ───────────
create table if not exists sgc.claude_borradores (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references sgc.usuarios(id) on delete cascade,
  tool        text not null,
  params      jsonb not null default '{}'::jsonb,
  resumen     text,
  estado      text not null default 'pendiente' check (estado in ('pendiente','confirmado','descartado','caducado')),
  idem        text not null,
  client_id   text,
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null default now() + interval '24 hours',
  resultado   jsonb
);
create index if not exists idx_claude_borradores_usuario
  on sgc.claude_borradores (usuario_id, estado, expira_en);
-- Idempotencia (§B3): mientras esté pendiente, el MISMO borrador se reutiliza
-- en vez de duplicarse (misma claveIdem que Compa — ver claude_borrador_crear).
create unique index if not exists uq_claude_borradores_idem_pendiente
  on sgc.claude_borradores (usuario_id, idem) where (estado = 'pendiente');

comment on table sgc.claude_borradores is
  'CR1 — lo que Claude Desktop PREPARA (proponer_*) vía MCP. Nunca ejecuta: confirmar pasa por claude-borrador (edge), mismo execRpc del registro compartido (AU1).';

-- ── 2) sgc.claude_llamadas — auditoría/telemetría del conector (§B4) ────────
create table if not exists sgc.claude_llamadas (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null default auth.uid() references sgc.usuarios(id) on delete cascade,
  herramienta   text not null,
  ok            boolean not null default true,
  error         text,
  duracion_ms   integer,
  filas         integer,
  client_id     text,
  -- Parámetros resumidos/truncados — NUNCA el resultado completo ni datos
  -- sensibles (CONTEXTO-51 §B4: "sin datos sensibles").
  params_resumen jsonb,
  creado_en     timestamptz not null default now()
);
create index if not exists idx_claude_llamadas_usuario
  on sgc.claude_llamadas (usuario_id, creado_en desc);

comment on table sgc.claude_llamadas is
  'CR1 — una fila por tools/call del servidor mcp (éxito o error). Retención 90 días (sgc.claude_llamadas_purgar, cron diario). NUNCA guarda el resultado completo.';

-- ── 3) RLS ───────────────────────────────────────────────────────────────────
alter table sgc.claude_borradores enable row level security;
alter table sgc.claude_llamadas   enable row level security;

drop policy if exists claude_borradores_rw on sgc.claude_borradores;
create policy claude_borradores_rw on sgc.claude_borradores
  for all using (usuario_id = auth.uid() or sgc.is_admin())
  with check (usuario_id = auth.uid());
-- (el with check NO incluye is_admin(): un admin puede LEER el borrador de otro
-- para soporte, pero solo el dueño puede crear/confirmar/descartar el suyo)

drop policy if exists claude_llamadas_sel on sgc.claude_llamadas;
create policy claude_llamadas_sel on sgc.claude_llamadas
  for select using (usuario_id = auth.uid() or sgc.is_admin());
drop policy if exists claude_llamadas_ins on sgc.claude_llamadas;
create policy claude_llamadas_ins on sgc.claude_llamadas
  for insert with check (usuario_id = auth.uid());

grant select, insert, update on sgc.claude_borradores to authenticated;
grant select, insert         on sgc.claude_llamadas   to authenticated;

-- ── 4) RPCs ──────────────────────────────────────────────────────────────────

-- Crea (o reutiliza, si hay uno pendiente con la misma `idem`) un borrador.
-- security invoker: la RLS de arriba ya exige usuario_id = auth.uid().
create or replace function sgc.claude_borrador_crear(
  p_tool text, p_params jsonb, p_resumen text, p_idem text
) returns sgc.claude_borradores
 language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_row sgc.claude_borradores;
  v_es_nuevo boolean;
begin
  -- security definer (no invoker): insertar en sgc.notificaciones exige permisos
  -- que un usuario normal no tiene directo (solo RPCs elevados como
  -- notificar_usuarios). auth.uid() se revalida explícitamente — nunca confiar
  -- en el invocador para el usuario_id de lo que se crea.
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;

  select not exists(
    select 1 from sgc.claude_borradores where usuario_id = auth.uid() and idem = p_idem and estado = 'pendiente'
  ) into v_es_nuevo;

  insert into sgc.claude_borradores (usuario_id, tool, params, resumen, idem, client_id)
  values (auth.uid(), p_tool, coalesce(p_params, '{}'::jsonb), p_resumen, p_idem, auth.jwt() ->> 'client_id')
  on conflict (usuario_id, idem) where (estado = 'pendiente')
  do update set params = excluded.params, resumen = excluded.resumen, creado_en = now(), expira_en = now() + interval '24 hours'
  returning * into v_row;

  -- CR1 §B3 — campana in-app ("Claude preparó un borrador para ti"), SIN push
  -- (insert directo a sgc.notificaciones, no sgc.notificar_usuarios — esa manda
  -- push siempre). Solo en el primer borrador de esta intención, no en cada
  -- reintento idempotente del mismo pedido.
  if v_es_nuevo then
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_id, referencia_tipo)
    values (auth.uid(), 'claude_borrador', 'Claude preparó un borrador para ti',
      coalesce(p_resumen, 'Revísalo y confírmalo cuando quieras.'), '/borrador/' || v_row.id, v_row.id, 'claude_borrador');
  end if;

  return v_row;
end;
$function$;
grant execute on function sgc.claude_borrador_crear(text, jsonb, text, text) to authenticated;

-- Lee un borrador propio (o de cualquiera, si admin). Caduca en caliente: si ya
-- pasó expira_en y seguía 'pendiente', lo marca 'caducado' antes de devolverlo.
create or replace function sgc.claude_borrador_obtener(p_id uuid)
 returns sgc.claude_borradores
 language plpgsql security invoker set search_path to 'sgc','pg_temp'
as $function$
declare v_row sgc.claude_borradores;
begin
  update sgc.claude_borradores set estado = 'caducado'
   where id = p_id and estado = 'pendiente' and expira_en < now();
  select * into v_row from sgc.claude_borradores where id = p_id;
  return v_row; -- RLS decide si esta sesión puede verlo; null si no existe/no autorizado
end;
$function$;
grant execute on function sgc.claude_borrador_obtener(uuid) to authenticated;

-- Descarta un borrador propio pendiente.
create or replace function sgc.claude_borrador_descartar(p_id uuid)
 returns boolean
 language sql security invoker set search_path to 'sgc','pg_temp'
as $function$
  update sgc.claude_borradores set estado = 'descartado'
   where id = p_id and usuario_id = auth.uid() and estado = 'pendiente'
  returning true;
$function$;
grant execute on function sgc.claude_borrador_descartar(uuid) to authenticated;

-- Registra una llamada del conector (éxito o error) — la hace el propio edge
-- `mcp` con el token del usuario, por eso security invoker (RLS exige su uid).
create or replace function sgc.claude_llamada_registrar(
  p_herramienta text, p_ok boolean, p_error text, p_duracion_ms integer,
  p_filas integer, p_params_resumen jsonb
) returns void
 language sql security invoker set search_path to 'sgc','pg_temp'
as $function$
  insert into sgc.claude_llamadas (usuario_id, herramienta, ok, error, duracion_ms, filas, client_id, params_resumen)
  values (auth.uid(), p_herramienta, coalesce(p_ok, true), p_error, p_duracion_ms, p_filas, auth.jwt() ->> 'client_id', p_params_resumen);
$function$;
grant execute on function sgc.claude_llamada_registrar(text, boolean, text, integer, integer, jsonb) to authenticated;

-- Admin › Claude: quién conectó, desde cuándo, última actividad, consultas 7d.
-- security definer — necesita ver TODAS las filas de claude_llamadas (la RLS
-- de arriba las limita a "las suyas"); por eso valida sgc.is_admin() primero.
create or replace function sgc.claude_conexiones_listado()
 returns table (
   usuario_id uuid, nombre text, conectado_desde timestamptz,
   ultima_actividad timestamptz, consultas_7d bigint, total_llamadas bigint
 )
 language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    -- u.nombre es varchar(150): plpgsql exige el cast explícito a text en
    -- `return query` (a diferencia de `language sql`, que coerciona solo) —
    -- mismo defecto que CQ5 (audit_log_listado), guard verify-returns-table-casts.mjs.
    select l.usuario_id, u.nombre::text, min(l.creado_en), max(l.creado_en),
           count(*) filter (where l.creado_en > now() - interval '7 days'),
           count(*)
      from sgc.claude_llamadas l
      join sgc.usuarios u on u.id = l.usuario_id
     group by l.usuario_id, u.nombre
     order by max(l.creado_en) desc;
end;
$function$;
grant execute on function sgc.claude_conexiones_listado() to authenticated;

-- Interruptores del conector, a prueba de la RLS restrictiva de `parametros`
-- (solo admin/dirección puede leer esa tabla directamente — ver docs/CLAUDE-CONECTOR.md).
-- security definer de solo-lectura, sin datos de negocio: seguro para cualquier
-- usuario autenticado, es lo mismo que necesita revisar en cada tools/call.
create or replace function sgc.claude_conector_config()
 returns jsonb
 language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select jsonb_build_object(
    'activo', coalesce((select valor from sgc.parametros where clave = 'claude_conector_activo'), 'true') = 'true',
    'solo_autorizados', coalesce((select valor from sgc.parametros where clave = 'claude_conector_solo_autorizados'), 'false') = 'true',
    'clientes_extra', coalesce((select valor from sgc.parametros where clave = 'claude_conector_clientes_extra'), 'false') = 'true',
    'max_hora', coalesce((select valor from sgc.parametros where clave = 'claude_conector_max_hora'), '120')::int
  );
$function$;
grant execute on function sgc.claude_conector_config() to authenticated;

-- Retención 90 días (§B4) — cron diario, ver docs/CRONS.md.
create or replace function sgc.claude_llamadas_purgar()
 returns void
 language sql security definer set search_path to 'sgc','pg_temp'
as $function$
  delete from sgc.claude_llamadas where creado_en < now() - interval '90 days';
$function$;
grant execute on function sgc.claude_llamadas_purgar() to authenticated;

select cron.schedule(
  'sgc-claude-llamadas-purgar', '0 9 * * *', -- 05:00 RD
  $$select sgc.claude_llamadas_purgar()$$
);

-- ── 5) Parámetros (§B1) ──────────────────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('claude_conector_activo',          'true',  'CR1 — interruptor general del conector de Claude Desktop (MCP). Se revisa en cada tools/call.'),
  ('claude_conector_solo_autorizados','false', 'CR1 — si es true, exige que la persona esté en una lista autorizada (por decidir el mecanismo si algún día hace falta; hoy "todos" por decisión de Xaviel).'),
  ('claude_conector_clientes_extra',  'false', 'CR1 — si es true, permite clientes MCP que no sean de Claude (lista blanca de redirect_uri) en /oauth/consent.'),
  ('claude_conector_max_hora',        '120',   'CR1 — tope de llamadas del conector por persona por hora.')
on conflict (clave) do nothing;

-- ── 6) auditoria.origen = 'claude' cuando el token trae client_id (§B4) ──────
-- Regla 19: cuerpo IDÉNTICO al verificado en vivo en prod hoy (18-oct-2026) vía
-- pg_get_functiondef — único cambio: v_origen prioriza auth.jwt()->>'client_id'
-- sobre el header x-sgc-client (un token OAuth de Claude no manda ese header).
create or replace function sgc.fn_auditoria()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_imp   uuid := sgc.impersonado_por();
  v_origen text;
  v_old   jsonb;
  v_new   jsonb;
  v_cambios jsonb := '{}'::jsonb;
  k text;
  v_skip constant text[] := array['updated_at','actualizado_en','search','tsv','fts','embedding','search_vector'];
begin
  -- CR1 — un token emitido por el servidor OAuth de Supabase trae `client_id`;
  -- una sesión normal (login de siempre) no. Si lo trae, el origen es 'claude'
  -- sin importar qué cliente MCP lo mandó (hoy solo exponemos el servidor a
  -- Claude — ver la lista blanca de /oauth/consent, FASE 3).
  begin
    v_origen := case when nullif(auth.jwt() ->> 'client_id', '') is not null then 'claude' else null end;
  exception when others then
    v_origen := null;
  end;
  -- CQ3 — "desde dónde" (web@1.193.0 / app@2.55.0). Mismo patrón defensivo que
  -- impersonado_por(): si el header no viene (ej. llamadas vía SQL directo,
  -- service_role, o un PostgREST sin ese GUC) nunca tumba el trigger.
  if v_origen is null then
    begin
      v_origen := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sgc-client', '');
    exception when others then
      v_origen := null;
    end;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, datos_despues, origen)
      values (tg_table_name, coalesce(v_new->>'id',''), 'INSERT', v_actor, v_imp, v_new, v_origen);
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k = any(v_skip) then continue; end if;
      if (v_new->k) is distinct from (v_old->k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k));
      end if;
    end loop;
    if v_cambios <> '{}'::jsonb then
      insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, cambios, origen)
        values (tg_table_name, coalesce(v_new->>'id',''), 'UPDATE', v_actor, v_imp, v_cambios, v_origen);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, datos_antes, origen)
      values (tg_table_name, coalesce(v_old->>'id',''), 'DELETE', v_actor, v_imp, v_old, v_origen);
    return old;
  end if;
  return null;
end;
$function$;

commit;
