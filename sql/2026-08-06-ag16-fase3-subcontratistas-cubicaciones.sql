-- ============================================================================
-- AG16 · Gestión de Producción de Obra — FASE 3: Subcontratistas y Cubicaciones.
-- Rutina 5 del Gerente de Producción. GREENFIELD (no existía nada) — NO se mete
-- en `proveedores` (suplidores de material). Puente: `proyecto_empleados`
-- con externo_tipo='subcontratista' puede promoverse a este registro.
--
-- Cubicaciones = valuaciones de avance del subcontratista con flujo de
-- aprobación (borrador → en_revision → aprobada|rechazada) + historial.
-- Aditivo. RLS: obra + proyectos + admin + submódulo obra.subcontratistas.
-- ============================================================================
set search_path = sgc, public;

-- ── Registro de subcontratistas (global) ──
create table if not exists sgc.obra_subcontratistas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  rnc          text,
  especialidad text,           -- acero, encofrado, plomería, eléctrico, pintura…
  contacto     text,
  telefono     text,
  activo       boolean not null default true,
  creado_por   uuid references sgc.usuarios(id),
  created_at   timestamptz not null default now()
);

-- ── Frentes asignados a un subcontratista por obra + avance ──
create table if not exists sgc.obra_subcontratista_frentes (
  id                uuid primary key default gen_random_uuid(),
  subcontratista_id uuid not null references sgc.obra_subcontratistas(id) on delete cascade,
  proyecto_id       uuid not null references sgc.proyectos(id) on delete cascade,
  elemento_id       uuid references sgc.obra_elementos(id) on delete set null,
  descripcion       text,
  avance_pct        numeric not null default 0 check (avance_pct >= 0 and avance_pct <= 100),
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists idx_subc_frentes_proyecto on sgc.obra_subcontratista_frentes(proyecto_id);
create index if not exists idx_subc_frentes_subc on sgc.obra_subcontratista_frentes(subcontratista_id);

-- ── Cubicaciones (valuaciones) con flujo de aprobación ──
create table if not exists sgc.obra_cubicaciones (
  id                uuid primary key default gen_random_uuid(),
  subcontratista_id uuid not null references sgc.obra_subcontratistas(id) on delete cascade,
  proyecto_id       uuid not null references sgc.proyectos(id) on delete cascade,
  periodo_inicio    date,
  periodo_fin       date,
  descripcion       text,
  monto             numeric not null default 0,
  avance_pct        numeric check (avance_pct is null or (avance_pct >= 0 and avance_pct <= 100)),
  detalle           jsonb not null default '[]',   -- items [{concepto, cantidad, precio, monto}]
  soportes          text[] not null default '{}',
  estado            text not null default 'borrador' check (estado in ('borrador','en_revision','aprobada','rechazada')),
  revisado_por      uuid references sgc.usuarios(id),
  revisado_en       timestamptz,
  nota_revision     text,
  creado_por        uuid references sgc.usuarios(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_cubic_proyecto on sgc.obra_cubicaciones(proyecto_id, estado);
create index if not exists idx_cubic_subc on sgc.obra_cubicaciones(subcontratista_id);

-- ── Historial de eventos de la cubicación ──
create table if not exists sgc.obra_cubicacion_eventos (
  id            uuid primary key default gen_random_uuid(),
  cubicacion_id uuid not null references sgc.obra_cubicaciones(id) on delete cascade,
  evento        text not null,       -- creada | enviada | aprobada | rechazada | editada
  estado_nuevo  text,
  nota          text,
  usuario_id    uuid references sgc.usuarios(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_cubic_eventos on sgc.obra_cubicacion_eventos(cubicacion_id, created_at);

-- ── RLS + grants ──
do $$
declare t text;
begin
  foreach t in array array['obra_subcontratistas','obra_subcontratista_frentes','obra_cubicaciones','obra_cubicacion_eventos']
  loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists %I_all on sgc.%I', t, t);
    execute format($p$create policy %I_all on sgc.%I for all to authenticated
        using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.puede_operar_submodulo('obra.subcontratistas'))
        with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.puede_operar_submodulo('obra.subcontratistas'))$p$, t, t);
    execute format('drop policy if exists %I_sel on sgc.%I', t, t);
    execute format($p$create policy %I_sel on sgc.%I for select to authenticated
        using (sgc.puede_ver_submodulo('obra.subcontratistas'))$p$, t, t);
    execute format('grant select, insert, update, delete on sgc.%I to authenticated', t);
    execute format('grant all on sgc.%I to service_role', t);
  end loop;
end $$;

-- ── Notificaciones (eventos de cubicación) ──
insert into sgc.notificaciones_config (evento, descripcion, in_app, push, email) values
  ('obra_cubicacion_revision', 'Cubicación enviada a revisión', true, true, false),
  ('obra_cubicacion_resuelta', 'Cubicación aprobada o rechazada', true, true, false)
on conflict (evento) do nothing;

-- ── RPCs ──

-- Crear/editar cubicación (idempotente por p_id; siempre nace en borrador).
create or replace function sgc.crear_cubicacion(
  p_id uuid, p_subcontratista_id uuid, p_proyecto_id uuid,
  p_periodo_inicio date, p_periodo_fin date, p_descripcion text,
  p_monto numeric, p_avance_pct numeric, p_detalle jsonb default '[]', p_soportes text[] default '{}'
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_id uuid; v_nuevo boolean;
begin
  v_nuevo := not exists (select 1 from sgc.obra_cubicaciones where id = p_id);
  insert into sgc.obra_cubicaciones
    (id, subcontratista_id, proyecto_id, periodo_inicio, periodo_fin, descripcion, monto, avance_pct, detalle, soportes, creado_por)
  values
    (coalesce(p_id, gen_random_uuid()), p_subcontratista_id, p_proyecto_id, p_periodo_inicio, p_periodo_fin,
     p_descripcion, coalesce(p_monto,0), p_avance_pct, coalesce(p_detalle,'[]'), coalesce(p_soportes,'{}'), auth.uid())
  on conflict (id) do update set
     subcontratista_id = excluded.subcontratista_id, periodo_inicio = excluded.periodo_inicio,
     periodo_fin = excluded.periodo_fin, descripcion = excluded.descripcion, monto = excluded.monto,
     avance_pct = excluded.avance_pct, detalle = excluded.detalle, soportes = excluded.soportes
  returning id into v_id;

  insert into sgc.obra_cubicacion_eventos (cubicacion_id, evento, estado_nuevo, usuario_id)
  values (v_id, case when v_nuevo then 'creada' else 'editada' end, 'borrador', auth.uid());
  return v_id;
end $$;
grant execute on function sgc.crear_cubicacion(uuid,uuid,uuid,date,date,text,numeric,numeric,jsonb,text[]) to authenticated, service_role;

-- Enviar a revisión (borrador → en_revision) + notificar gestores de obra.
create or replace function sgc.enviar_cubicacion(p_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_proy uuid; v_uid uuid;
begin
  update sgc.obra_cubicaciones set estado = 'en_revision'
    where id = p_id and estado = 'borrador'
    returning proyecto_id into v_proy;
  if v_proy is null then return; end if;

  insert into sgc.obra_cubicacion_eventos (cubicacion_id, evento, estado_nuevo, usuario_id)
  values (p_id, 'enviada', 'en_revision', auth.uid());

  if sgc.obra_notif_activo('obra_cubicacion_revision','in_app') then
    for v_uid in
      select distinct u.id from sgc.usuarios u
      join sgc.usuarios_roles ur on ur.usuario_id = u.id
      join sgc.roles r on r.id = ur.rol_id
      where coalesce(u.activo,true) and ('obra' = any(r.modulos) or 'admin' = any(r.modulos))
    loop
      perform sgc.notificar(v_uid, 'info', 'Cubicación por revisar', 'Hay una cubicación enviada a revisión.', '/obra/subcontratistas');
    end loop;
  end if;
end $$;
grant execute on function sgc.enviar_cubicacion(uuid) to authenticated, service_role;

-- Revisar (aprobar/rechazar) + notificar al creador.
create or replace function sgc.revisar_cubicacion(p_id uuid, p_estado text, p_nota text default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_creador uuid;
begin
  if p_estado not in ('aprobada','rechazada') then
    raise exception 'estado inválido: %', p_estado;
  end if;
  update sgc.obra_cubicaciones
    set estado = p_estado, revisado_por = auth.uid(), revisado_en = now(), nota_revision = p_nota
    where id = p_id and estado = 'en_revision'
    returning creado_por into v_creador;

  insert into sgc.obra_cubicacion_eventos (cubicacion_id, evento, estado_nuevo, nota, usuario_id)
  values (p_id, p_estado, p_estado, p_nota, auth.uid());

  if v_creador is not null and sgc.obra_notif_activo('obra_cubicacion_resuelta','in_app') then
    perform sgc.notificar(v_creador,
      case when p_estado='aprobada' then 'success' else 'warning' end,
      'Cubicación ' || p_estado,
      coalesce(p_nota, 'Tu cubicación fue ' || p_estado || '.'), '/obra/subcontratistas');
  end if;
end $$;
grant execute on function sgc.revisar_cubicacion(uuid,text,text) to authenticated, service_role;
