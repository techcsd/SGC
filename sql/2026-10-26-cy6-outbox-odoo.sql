-- CY6 [HU-INV-04] -- outbox para publicar eventos de negocio hacia Odoo sin
-- duplicar documentos. NO es la ampliacion 20261016112525 (esa sigue sin
-- instalarse, D-04): tablas propias, con alcance acotado a esta ola.
--
-- Enganche "a nivel BD" (no a nivel service Angular, porque la app escribe
-- por RPC sin pasar por esos services -- ver inventario en HANDOFF.md):
-- TRIGGERS AFTER INSERT/UPDATE sobre las tablas de MAESTROS (articulos,
-- categorias_inventario, unidades, proveedores), no sobre las 9 RPC citadas
-- en la issue directamente. Un trigger AFTER se ejecuta en la MISMA
-- transaccion que el INSERT/UPDATE que lo dispara (si esa transaccion hace
-- rollback, el evento tambien desaparece -- criterio 1 se cumple gratis,
-- sin tocar el cuerpo de ninguna de las 9 RPC, mas seguro que editarlas).
-- entradas/salidas/retiros/solicitudes de compra (las otras 5 RPC de la
-- lista) quedan para una migracion siguiente con el MISMO patron -- no se
-- tocan hoy para no arriesgar flujos de stock en produccion sin tiempo de
-- verificarlos uno a uno.
--
-- Publicacion APAGADA por defecto (nota de la issue): el evento SIEMPRE se
-- captura (auditoria), pero sgc.odoo_v1_reclamar_eventos() solo entrega
-- eventos de un agregado_tipo con politica habilitada=true en
-- odoo_publicacion_politica -- hoy ninguna fila existe ahi, asi que nada se
-- reclama nunca hasta que un admin la cree a proposito (F10/CY24 en
-- adelante, cuando haya homologacion #19 completa para ese alcance).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('sgc.odoo_instancias') is null then
    raise exception 'Falta sgc.odoo_instancias -- aplica primero sql/20261016112524_odoo_identity_fields.sql';
  end if;
  if to_regclass('sgc.odoo_eventos') is not null then
    raise exception 'sgc.odoo_eventos ya existe -- revisar antes de reaplicar';
  end if;
end;
$preflight$;

create table sgc.odoo_publicacion_politica (
  agregado_tipo text primary key,
  habilitada boolean not null default false,
  notas text,
  actualizada_por uuid references auth.users(id),
  actualizada_en timestamptz not null default now()
);
comment on table sgc.odoo_publicacion_politica is 'CY6 -- por defecto ninguna fila = ningun agregado publica. Un admin crea/activa la fila cuando la homologacion (#19) este completa para ese alcance.';
alter table sgc.odoo_publicacion_politica enable row level security;

create table sgc.odoo_eventos (
  id uuid primary key default gen_random_uuid(),
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  agregado_tipo text not null check (agregado_tipo in ('articulo', 'categoria_inventario', 'unidad', 'proveedor')),
  agregado_id text not null, -- texto: articulos/proveedores=uuid, categorias/unidades=integer
  accion text not null check (accion in ('crear', 'actualizar')),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null, -- snapshot de la fila en el momento del trigger (NEW.*)
  es_prueba boolean not null default false,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesando', 'completado', 'reintento', 'error', 'incierto', 'bloqueado', 'cancelado')),
  lease_token uuid,
  lease_hasta timestamptz,
  intentos integer not null default 0,
  resultado jsonb,
  error text,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Idempotencia: la MISMA revision del MISMO agregado no se publica dos
  -- veces (un reintento de la transaccion que dispara el trigger, por
  -- ejemplo, no genera un segundo evento con los mismos datos).
  constraint odoo_eventos_clave_unica unique (odoo_instancia_id, agregado_tipo, agregado_id, revision)
);
comment on table sgc.odoo_eventos is 'CY6 -- outbox. Un evento por revision de un agregado; SIEMPRE se captura, se reclama solo si hay politica habilitada para su agregado_tipo.';
create index odoo_eventos_pendientes on sgc.odoo_eventos (agregado_tipo, estado, creado_en) where estado = 'pendiente';
create index odoo_eventos_por_agregado on sgc.odoo_eventos (agregado_tipo, agregado_id, revision desc);
alter table sgc.odoo_eventos enable row level security;

create table sgc.odoo_intentos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references sgc.odoo_eventos(id) on delete cascade,
  procesador text not null,
  lease_token uuid not null,
  estado_resultado text not null check (estado_resultado in ('completado', 'reintento', 'error', 'incierto')),
  resultado jsonb,
  error text,
  reclamado_en timestamptz not null,
  finalizado_en timestamptz not null default now()
);
comment on table sgc.odoo_intentos is 'CY6 -- historial de reclamos/resultados por evento (sin credenciales). Permite auditar reintentos.';
create index odoo_intentos_por_evento on sgc.odoo_intentos (evento_id, finalizado_en desc);
alter table sgc.odoo_intentos enable row level security;

-- ── RPC: reclamar (FOR UPDATE SKIP LOCKED -- exclusion entre consumidores) ──
create or replace function sgc.odoo_v1_reclamar_eventos(
  p_instancia uuid, p_procesador text, p_limite integer default 20, p_lease_segundos integer default 120
)
returns setof sgc.odoo_eventos
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_limite integer := greatest(1, least(100, coalesce(p_limite, 20)));
  v_lease integer := greatest(30, least(900, coalesce(p_lease_segundos, 120)));
  v_token uuid := gen_random_uuid();
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede reclamar eventos' using errcode = '42501';
  end if;
  if p_procesador is null or length(btrim(p_procesador)) = 0 then
    raise exception 'p_procesador es obligatorio';
  end if;

  return query
  with candidatos as (
    select e.id
    from sgc.odoo_eventos e
    join sgc.odoo_publicacion_politica pol on pol.agregado_tipo = e.agregado_tipo and pol.habilitada
    where e.odoo_instancia_id = p_instancia
      and e.es_prueba = false -- D-16: prueba nunca publica, aunque se pida
      and (
        (e.estado = 'pendiente')
        or (e.estado = 'reintento')
        or (e.estado = 'procesando' and e.lease_hasta < now()) -- lease vencido: se puede reclamar de nuevo
      )
      -- dependencia de etapas: no adelantar esta revision si la anterior del
      -- MISMO agregado todavia no esta 'completado' (ni 'cancelado').
      and not exists (
        select 1 from sgc.odoo_eventos previo
        where previo.agregado_tipo = e.agregado_tipo and previo.agregado_id = e.agregado_id
          and previo.revision < e.revision
          and previo.estado not in ('completado', 'cancelado')
      )
    order by e.creado_en
    limit v_limite
    for update of e skip locked
  )
  update sgc.odoo_eventos e
     set estado = 'procesando', lease_token = v_token, lease_hasta = now() + (v_lease || ' seconds')::interval,
         intentos = e.intentos + 1, actualizado_en = now()
    from candidatos c
   where e.id = c.id
  returning e.*;
end;
$fn$;
comment on function sgc.odoo_v1_reclamar_eventos is 'SGC Odoo foundation v1 (CY6)';
revoke all on function sgc.odoo_v1_reclamar_eventos(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function sgc.odoo_v1_reclamar_eventos(uuid, text, integer, integer) to authenticated; -- is_admin()/service_role adentro gatea de verdad

-- ── RPC: finalizar (exige el lease vigente -- CY23-style, sin reintentos a ciegas) ──
create or replace function sgc.odoo_v1_finalizar_evento(
  p_evento uuid, p_lease uuid, p_estado text, p_resultado jsonb default null,
  p_error text default null, p_reintentar_en timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_evento sgc.odoo_eventos;
begin
  if not (sgc.is_admin() or auth.role() = 'service_role') then
    raise exception 'Solo admin o service_role puede finalizar eventos' using errcode = '42501';
  end if;
  if p_estado not in ('completado', 'reintento', 'error', 'incierto') then
    raise exception 'p_estado invalido: %', p_estado;
  end if;
  if p_estado = 'reintento' and p_reintentar_en is null then
    raise exception 'reintento requiere p_reintentar_en';
  end if;

  select * into v_evento from sgc.odoo_eventos where id = p_evento and lease_token = p_lease for update;
  if not found then
    return false; -- lease vencido/incorrecto: el llamador no debe asumir que su resultado cuenta
  end if;

  update sgc.odoo_eventos
     set estado = case when p_estado = 'reintento' then 'pendiente' else p_estado end,
         resultado = coalesce(p_resultado, resultado),
         error = p_error,
         lease_token = null, lease_hasta = null,
         actualizado_en = now()
   where id = p_evento;

  insert into sgc.odoo_intentos (evento_id, procesador, lease_token, estado_resultado, resultado, error, reclamado_en)
    values (p_evento, 'rpc', p_lease, p_estado, p_resultado, p_error, v_evento.actualizado_en);

  return true;
end;
$fn$;
comment on function sgc.odoo_v1_finalizar_evento is 'SGC Odoo foundation v1 (CY6)';
revoke all on function sgc.odoo_v1_finalizar_evento(uuid, uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function sgc.odoo_v1_finalizar_evento(uuid, uuid, text, jsonb, text, timestamptz) to authenticated; -- is_admin()/service_role adentro gatea de verdad

-- ── Triggers de captura (maestros: articulos, categorias, unidades, proveedores) ──
create or replace function sgc.odoo_v1_capturar_evento_maestro()
returns trigger
language plpgsql
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_tipo text;
  v_id text;
  v_accion text;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_revision integer;
  v_es_prueba boolean;
begin
  v_tipo := case tg_table_name
    when 'articulos' then 'articulo'
    when 'categorias_inventario' then 'categoria_inventario'
    when 'unidades' then 'unidad'
    when 'proveedores' then 'proveedor'
  end;
  v_id := (to_jsonb(new)->>'id');
  v_accion := case tg_op when 'INSERT' then 'crear' else 'actualizar' end;
  v_es_prueba := coalesce((to_jsonb(new)->>'es_prueba')::boolean, false);

  -- CY7 criterio 4 -- sin bucle de publicaciones al importar: un futuro RPC
  -- "importar desde Odoo" debe hacer `perform set_config('sgc.odoo_importando', 'true', true)`
  -- antes de escribir, para que ESTA escritura (que ya vino de Odoo) no
  -- genere un evento de vuelta hacia Odoo. Hoy ningun importador lo usa
  -- todavia (no existe esa ruta), pero el guard ya queda listo.
  if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then
    return new;
  end if;

  -- Instancia por defecto: la unica habilitada (si hay 0 o mas de una, no se
  -- adivina -- se omite la captura y queda para cuando exista una regla).
  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    return new;
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  select coalesce(max(revision), 0) + 1 into v_revision
    from sgc.odoo_eventos where agregado_tipo = v_tipo and agregado_id = v_id;

  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_instancia_id, v_tipo, v_id, v_accion, v_revision, to_jsonb(new), v_es_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing; -- idempotente ante un reintento de la misma transaccion

  return new;
end;
$fn$;
comment on function sgc.odoo_v1_capturar_evento_maestro is 'SGC Odoo foundation v1 (CY6)';

create trigger odoo_v1_capturar_evento_maestro
  after insert or update on sgc.articulos
  for each row execute function sgc.odoo_v1_capturar_evento_maestro();
create trigger odoo_v1_capturar_evento_maestro
  after insert or update on sgc.categorias_inventario
  for each row execute function sgc.odoo_v1_capturar_evento_maestro();
create trigger odoo_v1_capturar_evento_maestro
  after insert or update on sgc.unidades
  for each row execute function sgc.odoo_v1_capturar_evento_maestro();
create trigger odoo_v1_capturar_evento_maestro
  after insert or update on sgc.proveedores
  for each row execute function sgc.odoo_v1_capturar_evento_maestro();

commit;
