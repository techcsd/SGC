-- 2026-10-07-ci4-solicitudes-eliminacion.sql
-- CI4 — Eliminación de cuenta: solicitud (app/web/pública) + procesamiento con anonimización.
-- Aditivo. La parte de Auth (ban/cerrar sesión/borrar foto del bucket) la hace la edge
-- admin-procesar-eliminacion; aquí va la mutación de datos (SECURITY DEFINER, admin-gated).
--   node scripts/apply-migration.mjs sql/2026-10-07-ci4-solicitudes-eliminacion.sql --env dev

-- ── Tabla ──────────────────────────────────────────────────────────────────────
create table if not exists sgc.solicitudes_eliminacion_cuenta (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid references sgc.usuarios(id) on delete set null,
  identificador text,                                   -- correo/cédula que dio el solicitante
  motivo        text,
  origen        text not null default 'app' check (origen in ('app','web','publica')),
  estado        text not null default 'pendiente' check (estado in ('pendiente','procesada','rechazada')),
  creada_at     timestamptz not null default now(),
  procesada_at  timestamptz,
  procesada_por uuid references sgc.usuarios(id),
  nota_admin    text
);
-- Una sola pendiente por usuario (idempotencia del RPC autenticado).
create unique index if not exists solic_elim_una_pendiente_por_usuario
  on sgc.solicitudes_eliminacion_cuenta (usuario_id) where (estado = 'pendiente' and usuario_id is not null);
create index if not exists solic_elim_estado on sgc.solicitudes_eliminacion_cuenta (estado, creada_at desc);
comment on table sgc.solicitudes_eliminacion_cuenta is
  'CI4 — solicitudes de eliminación de cuenta (derecho de cancelación, Ley 172-13 + tiendas).';

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table sgc.solicitudes_eliminacion_cuenta enable row level security;

drop policy if exists solic_elim_sel on sgc.solicitudes_eliminacion_cuenta;
create policy solic_elim_sel on sgc.solicitudes_eliminacion_cuenta
  for select to authenticated
  using ( usuario_id = auth.uid() or sgc.is_admin() or sgc.es_tecnologia() );

drop policy if exists solic_elim_ins on sgc.solicitudes_eliminacion_cuenta;
create policy solic_elim_ins on sgc.solicitudes_eliminacion_cuenta
  for insert to authenticated
  with check ( usuario_id = auth.uid() );

grant select, insert on sgc.solicitudes_eliminacion_cuenta to authenticated;
grant all on sgc.solicitudes_eliminacion_cuenta to service_role;

-- ── RPC: solicitar (usuario autenticado, idempotente) ────────────────────────────
create or replace function sgc.solicitar_eliminacion_cuenta(
  p_motivo text,
  p_plataforma text default null
)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_origen text := case when coalesce(p_plataforma,'') ilike 'web%' then 'web' else 'app' end;
  v_id uuid;
  v_ident text;
  v_actor text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select id into v_id
  from sgc.solicitudes_eliminacion_cuenta
  where usuario_id = v_uid and estado = 'pendiente' limit 1;
  if v_id is not null then return v_id; end if;   -- ya hay una pendiente

  select email, nombre into v_ident, v_actor from sgc.usuarios where id = v_uid;

  insert into sgc.solicitudes_eliminacion_cuenta (usuario_id, identificador, motivo, origen)
  values (v_uid, v_ident, nullif(trim(p_motivo), ''), v_origen)
  returning id into v_id;

  begin
    perform sgc.notificar_modulo('tecnologia', 'eliminacion_cuenta_solicitud',
      'Solicitud de eliminación de cuenta',
      coalesce(v_actor, 'Un usuario') || ' solicitó eliminar su cuenta.',
      '/admin/solicitudes-eliminacion');
  exception when others then null; -- el aviso nunca bloquea
  end;

  return v_id;
end;
$$;
grant execute on function sgc.solicitar_eliminacion_cuenta(text, text) to authenticated;

-- ── RPC: crear solicitud pública (la llama la edge con service role) ──────────────
create or replace function sgc.crear_solicitud_eliminacion_publica(
  p_identificador text,
  p_motivo text default null
)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ident text := nullif(trim(p_identificador), '');
  v_uid uuid;
begin
  if v_ident is null then return; end if;  -- responde igual aunque venga vacío

  -- Resuelve el usuario por correo o cédula (no revela nada al solicitante).
  select id into v_uid from sgc.usuarios
  where lower(email) = lower(v_ident) or cedula = v_ident
  limit 1;

  -- Si ya hay una pendiente de ese usuario, no duplica.
  if v_uid is not null and exists (
    select 1 from sgc.solicitudes_eliminacion_cuenta
    where usuario_id = v_uid and estado = 'pendiente'
  ) then
    return;
  end if;

  insert into sgc.solicitudes_eliminacion_cuenta (usuario_id, identificador, motivo, origen)
  values (v_uid, v_ident, nullif(trim(p_motivo), ''), 'publica');

  begin
    perform sgc.notificar_modulo('tecnologia', 'eliminacion_cuenta_solicitud',
      'Solicitud pública de eliminación de cuenta',
      'Llegó una solicitud de eliminación desde la página pública (' || v_ident || ').',
      '/admin/solicitudes-eliminacion');
  exception when others then null;
  end;
end;
$$;
grant execute on function sgc.crear_solicitud_eliminacion_publica(text, text) to service_role;

-- ── RPC: procesar (admin) — anonimiza y marca; devuelve el usuario a banear ───────
create or replace function sgc.procesar_solicitud_eliminacion(
  p_solicitud_id uuid,
  p_accion text,          -- 'procesar' | 'rechazar'
  p_nota text default null
)
returns uuid               -- usuario_id anonimizado (para que la edge banee/cierre sesión), o null
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid;
  v_target uuid;
begin
  if not sgc.is_admin() then raise exception 'Solo administración puede procesar solicitudes'; end if;
  v_uid := auth.uid();

  select usuario_id into v_target
  from sgc.solicitudes_eliminacion_cuenta
  where id = p_solicitud_id and estado = 'pendiente'
  for update;
  if not found then raise exception 'Solicitud no encontrada o ya resuelta'; end if;

  if p_accion = 'rechazar' then
    update sgc.solicitudes_eliminacion_cuenta
      set estado = 'rechazada', procesada_at = now(), procesada_por = v_uid, nota_admin = nullif(trim(p_nota), '')
      where id = p_solicitud_id;
    insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
    values (v_uid, 'eliminacion_cuenta_rechazada', v_target, jsonb_build_object('solicitud_id', p_solicitud_id, 'nota', p_nota));
    return null;
  end if;

  if p_accion <> 'procesar' then raise exception 'Acción inválida: %', p_accion; end if;

  -- Anonimiza el perfil (se conservan los registros operativos con el usuario anonimizado).
  if v_target is not null then
    update sgc.usuarios set
      nombre       = 'Usuario eliminado',
      email        = 'eliminado-' || id::text || '@constructorasd.invalid',
      telefono     = null,
      cedula       = null,
      avatar_path  = null,
      activo       = false,
      updated_at   = now()
    where id = v_target;

    delete from sgc.device_tokens where usuario_id = v_target;
  end if;

  update sgc.solicitudes_eliminacion_cuenta
    set estado = 'procesada', procesada_at = now(), procesada_por = v_uid, nota_admin = nullif(trim(p_nota), '')
    where id = p_solicitud_id;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (v_uid, 'eliminacion_cuenta_procesada', v_target, jsonb_build_object('solicitud_id', p_solicitud_id));

  return v_target;
end;
$$;
grant execute on function sgc.procesar_solicitud_eliminacion(uuid, text, text) to authenticated;
