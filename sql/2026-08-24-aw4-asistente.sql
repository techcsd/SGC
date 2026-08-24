-- ============================================================================
-- AW4 — Asistente de IA "Tato" (v1 solo-lectura). Backend: tablas de
-- conversación/auditoría + RPC de capacidades del usuario.
--
-- Principio (PLAN-ASISTENTE-IA §2): el asistente HEREDA los permisos del
-- usuario. La edge function ejecuta las herramientas con el JWT del usuario
-- (RLS aplica sola). Estas tablas guardan la conversación y la AUDITORÍA de
-- qué herramientas tocó el asistente y con qué parámetros.
-- Todo aditivo. `es_prueba` aplica también aquí.
-- ============================================================================

begin;

-- ── Conversaciones ────────────────────────────────────────────────────────
create table if not exists sgc.assistant_conversaciones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references sgc.usuarios(id) on delete cascade,
  titulo     text,
  es_prueba  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assistant_conv_usuario
  on sgc.assistant_conversaciones (usuario_id, updated_at desc);

-- ── Mensajes ──────────────────────────────────────────────────────────────
create table if not exists sgc.assistant_mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references sgc.assistant_conversaciones(id) on delete cascade,
  rol             text not null check (rol in ('user','assistant')),
  contenido       text,
  -- Resumen de las herramientas que el asistente usó para ESTA respuesta
  -- (transparencia: "de dónde salió el número"). No guarda toda la data.
  herramientas    jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assistant_msg_conv
  on sgc.assistant_mensajes (conversacion_id, created_at);

-- ── Auditoría de acciones (qué tool, qué params, resultado) ─────────────────
create table if not exists sgc.assistant_acciones (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid references sgc.assistant_conversaciones(id) on delete set null,
  usuario_id      uuid not null default auth.uid(),
  tool            text not null,
  params          jsonb,
  ok              boolean,
  resumen         text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assistant_acc_usuario
  on sgc.assistant_acciones (usuario_id, created_at desc);

-- ── RLS: cada quien ve/gestiona lo suyo; admin ve todo (auditoría) ──────────
alter table sgc.assistant_conversaciones enable row level security;
alter table sgc.assistant_mensajes       enable row level security;
alter table sgc.assistant_acciones       enable row level security;

drop policy if exists assistant_conv_rw on sgc.assistant_conversaciones;
create policy assistant_conv_rw on sgc.assistant_conversaciones
  for all using (usuario_id = auth.uid() or sgc.is_admin())
  with check (usuario_id = auth.uid() or sgc.is_admin());

drop policy if exists assistant_msg_rw on sgc.assistant_mensajes;
create policy assistant_msg_rw on sgc.assistant_mensajes
  for all using (exists (select 1 from sgc.assistant_conversaciones c
                          where c.id = conversacion_id
                            and (c.usuario_id = auth.uid() or sgc.is_admin())))
  with check (exists (select 1 from sgc.assistant_conversaciones c
                       where c.id = conversacion_id
                         and (c.usuario_id = auth.uid() or sgc.is_admin())));

drop policy if exists assistant_acc_rw on sgc.assistant_acciones;
create policy assistant_acc_rw on sgc.assistant_acciones
  for all using (usuario_id = auth.uid() or sgc.is_admin())
  with check (usuario_id = auth.uid() or sgc.is_admin());

grant select, insert, update, delete on sgc.assistant_conversaciones to authenticated;
grant select, insert, update, delete on sgc.assistant_mensajes       to authenticated;
grant select, insert                 on sgc.assistant_acciones       to authenticated;

-- ── capacidades_asistente() — qué puede hacer el usuario que habla ──────────
-- Punto de verdad único que consume la edge function para armar el catálogo de
-- herramientas permitidas y el contexto del system prompt.
create or replace function sgc.capacidades_asistente()
 returns jsonb
 language plpgsql stable security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_nombre text;
  v_admin  boolean;
  v_mods   text[] := '{}';
  m        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select nombre into v_nombre from sgc.usuarios where id = v_uid;
  v_admin := sgc.is_admin();
  foreach m in array array['inventario','compras','rrhh','proyectos','flota',
                           'bitacora','documentos','plantillas','legal','tareas',
                           'tecnologia','direccion','admin'] loop
    if v_admin or sgc.tiene_modulo(m) then v_mods := v_mods || m; end if;
  end loop;
  return jsonb_build_object(
    'usuario_id', v_uid,
    'nombre', coalesce(v_nombre, 'Usuario'),
    'es_admin', v_admin,
    'modulos', to_jsonb(v_mods),
    'puede_ver_todas_requisiciones', sgc.puede_ver_todas_requisiciones()
  );
end;
$function$;
grant execute on function sgc.capacidades_asistente() to authenticated;

-- ── Rate limit: mensajes de usuario en la última hora ───────────────────────
create or replace function sgc.assistant_mensajes_ultima_hora()
 returns integer
 language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select count(*)::int
    from sgc.assistant_mensajes msg
    join sgc.assistant_conversaciones c on c.id = msg.conversacion_id
   where c.usuario_id = auth.uid()
     and msg.rol = 'user'
     and msg.created_at > now() - interval '1 hour';
$function$;
grant execute on function sgc.assistant_mensajes_ultima_hora() to authenticated;

commit;
