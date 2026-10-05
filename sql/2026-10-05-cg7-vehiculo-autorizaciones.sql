-- CG7 — El chofer privado solo ve los vehículos que admin o un rol elevado (Raykler)
-- le autorice. Tabla de autorizaciones con vigencia + RLS + rama en puede_ver_vehiculo().
-- Nota (literal): "Chofer privado only must be able to see the selected vehicles that admin
-- or an elevated role like the raykler has permit to he to see."
-- -------------------------------------------------------------------------------------
-- Diseño: una autorización es ADITIVA a puede_ver_vehiculo (que ya concede al responsable /
-- asignación activa / uso abierto). Un chofer_privado normalmente no tiene ninguno de esos,
-- así que en la práctica ve SOLO los vehículos que tenga autorizados y vigentes. Escriben
-- admin y es_flota_elevado(); el propio usuario lee las suyas. Toda autorización se audita.

-- ── Tabla ────────────────────────────────────────────────────────────────────────────
create table if not exists sgc.vehiculo_autorizaciones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references sgc.usuarios(id) on delete cascade,
  vehiculo_id   uuid not null references sgc.vehiculos(id) on delete cascade,
  autorizado_por uuid references sgc.usuarios(id),
  desde         date not null default current_date,
  hasta         date,                 -- null = sin vencimiento
  nota          text,
  activa        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Una autorización activa por (usuario, vehículo): re-autorizar reactiva/actualiza.
create unique index if not exists vehiculo_autorizaciones_uq_activa
  on sgc.vehiculo_autorizaciones (usuario_id, vehiculo_id) where activa;
create index if not exists vehiculo_autorizaciones_usuario_idx on sgc.vehiculo_autorizaciones (usuario_id) where activa;
create index if not exists vehiculo_autorizaciones_vehiculo_idx on sgc.vehiculo_autorizaciones (vehiculo_id) where activa;

comment on table sgc.vehiculo_autorizaciones is
  'CG7 — vehículos que un chofer privado puede ver/usar, otorgados por admin/flota-elevado, con vigencia (desde/hasta). Aditivo a puede_ver_vehiculo.';

-- ── Vigencia helper ────────────────────────────────────────────────────────────────
create or replace function sgc.autorizacion_vehiculo_vigente(p_vehiculo uuid, p_usuario uuid)
returns boolean
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select exists (
    select 1 from sgc.vehiculo_autorizaciones a
     where a.vehiculo_id = p_vehiculo
       and a.usuario_id  = p_usuario
       and a.activa
       and a.desde <= current_date
       and (a.hasta is null or a.hasta >= current_date)
  );
$function$;

-- ── puede_ver_vehiculo() con la rama CG7 (se reconstruye entera, CD4 + CG7) ──────────
create or replace function sgc.puede_ver_vehiculo(p_vehiculo uuid, p_usuario uuid)
returns boolean
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select
    sgc.is_admin() or sgc.es_flota_elevado()
    or exists (select 1 from sgc.vehiculos v
                where v.id = p_vehiculo and v.responsable_id = p_usuario)
    or exists (select 1 from sgc.vehiculo_asignaciones va
                where va.vehiculo_id = p_vehiculo and va.usuario_id = p_usuario and va.activa)
    or exists (select 1 from sgc.vehiculo_usos vu
                where vu.vehiculo_id = p_vehiculo and vu.usuario_id = p_usuario and vu.fin_at is null)
    -- CG7 — autorización explícita (chofer privado y cualquier otro autorizado a un vehículo).
    or sgc.autorizacion_vehiculo_vigente(p_vehiculo, p_usuario);
$function$;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────
alter table sgc.vehiculo_autorizaciones enable row level security;

drop policy if exists vehiculo_autorizaciones_select on sgc.vehiculo_autorizaciones;
create policy vehiculo_autorizaciones_select on sgc.vehiculo_autorizaciones
  for select to authenticated
  using ( usuario_id = auth.uid() or sgc.is_admin() or sgc.es_flota_elevado() );

drop policy if exists vehiculo_autorizaciones_write on sgc.vehiculo_autorizaciones;
create policy vehiculo_autorizaciones_write on sgc.vehiculo_autorizaciones
  for all to authenticated
  using ( sgc.is_admin() or sgc.es_flota_elevado() )
  with check ( sgc.is_admin() or sgc.es_flota_elevado() );

grant select, insert, update, delete on sgc.vehiculo_autorizaciones to authenticated;

-- ── RPCs de gestión (auditan) ─────────────────────────────────────────────────────────
-- Autoriza (o re-autoriza) a un usuario sobre un vehículo. Solo admin/flota-elevado.
create or replace function sgc.autorizar_vehiculo_privado(
  p_usuario uuid, p_vehiculo uuid, p_desde date default current_date, p_hasta date default null, p_nota text default null
) returns sgc.vehiculo_autorizaciones
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_row sgc.vehiculo_autorizaciones;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  insert into sgc.vehiculo_autorizaciones (usuario_id, vehiculo_id, autorizado_por, desde, hasta, nota, activa)
  values (p_usuario, p_vehiculo, auth.uid(), coalesce(p_desde, current_date), p_hasta, p_nota, true)
  on conflict (usuario_id, vehiculo_id) where activa
  do update set desde = excluded.desde, hasta = excluded.hasta, nota = excluded.nota, autorizado_por = auth.uid()
  returning * into v_row;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'vehiculo_autorizacion_creada', p_usuario,
          jsonb_build_object('vehiculo_id', p_vehiculo, 'desde', coalesce(p_desde, current_date), 'hasta', p_hasta));
  return v_row;
end;
$function$;

-- Retira una autorización (activa=false). Solo admin/flota-elevado.
create or replace function sgc.retirar_vehiculo_privado(p_id uuid)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_row sgc.vehiculo_autorizaciones;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.vehiculo_autorizaciones set activa = false where id = p_id returning * into v_row;
  if v_row.id is null then raise exception 'Autorización no encontrada' using errcode = 'P0002'; end if;
  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'vehiculo_autorizacion_retirada', v_row.usuario_id,
          jsonb_build_object('vehiculo_id', v_row.vehiculo_id, 'autorizacion_id', p_id));
end;
$function$;

-- Lista las autorizaciones activas de un vehículo (para la ficha). admin/flota-elevado.
create or replace function sgc.listar_autorizaciones_vehiculo(p_vehiculo uuid)
returns table (id uuid, usuario_id uuid, usuario_nombre text, desde date, hasta date, nota text, autorizado_por_nombre text, created_at timestamptz)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select a.id, a.usuario_id, u.nombre::text, a.desde, a.hasta, a.nota, ap.nombre::text, a.created_at
    from sgc.vehiculo_autorizaciones a
    join sgc.usuarios u on u.id = a.usuario_id
    left join sgc.usuarios ap on ap.id = a.autorizado_por
   where a.vehiculo_id = p_vehiculo and a.activa
     and (sgc.is_admin() or sgc.es_flota_elevado())
   order by a.created_at desc;
$function$;

grant execute on function sgc.autorizacion_vehiculo_vigente(uuid, uuid) to authenticated;
grant execute on function sgc.puede_ver_vehiculo(uuid, uuid) to authenticated;
grant execute on function sgc.autorizar_vehiculo_privado(uuid, uuid, date, date, text) to authenticated;
grant execute on function sgc.retirar_vehiculo_privado(uuid) to authenticated;
grant execute on function sgc.listar_autorizaciones_vehiculo(uuid) to authenticated;
