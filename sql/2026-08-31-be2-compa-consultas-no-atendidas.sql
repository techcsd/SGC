-- =============================================================================
-- PROMPT-25 FASE 1 (BE2) — Registro de consultas no atendidas de Compa + panel.
-- Ronda 19/08-01/09/2026 (IDs BE). Aditivo, idempotente, retrocompatible.
--
-- Institucionaliza lo que Xaviel hacía a mano con capturas: cada vez que Compa
-- (a) no tiene herramienta para algo, (b) una tool falla, o (c) falla por permiso,
-- se registra { pregunta, rol, motivo, fecha, conversación }. Esa lista ES el
-- backlog de tools de Compa — la próxima tanda de capacidades sale de datos, no de
-- screenshots. Panel en Tecnología (es_tecnologia) con conteos por tipo.
--
-- Un solo camino (AU1): el edge registra vía este RPC (SECURITY DEFINER, estampa
-- auth.uid() + snapshot de roles). El panel lee vía RPC gateado por es_tecnologia.
-- =============================================================================

begin;

create table if not exists sgc.assistant_consultas_no_atendidas (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid references sgc.usuarios(id),
  usuario_nombre  text,                          -- snapshot legible (por si el usuario cambia)
  roles_snapshot  text,                          -- roles del usuario al momento (coma-separados)
  pregunta        text not null,                 -- la pregunta literal del usuario
  motivo          text not null
                    check (motivo in ('sin_tool','error_de_tool','sin_permiso')),
  tool            text,                          -- tool que falló (si aplica)
  detalle         text,                          -- mensaje de error técnico (para Tecnología)
  conversacion_id uuid,                          -- para reabrir el hilo en el chat
  resuelto        boolean not null default false,-- Tecnología marca cuando ya construyó la capacidad
  resuelto_por    uuid references sgc.usuarios(id),
  resuelto_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_compa_no_atendidas_created
  on sgc.assistant_consultas_no_atendidas (created_at desc);
create index if not exists idx_compa_no_atendidas_motivo
  on sgc.assistant_consultas_no_atendidas (motivo, created_at desc);

alter table sgc.assistant_consultas_no_atendidas enable row level security;

-- Escritura: solo vía el RPC SECURITY DEFINER (no política de insert directa).
-- Lectura: solo Tecnología. El propio usuario NO ve el backlog (es una herramienta
-- de producto, no del usuario final).
drop policy if exists cna_select_tec on sgc.assistant_consultas_no_atendidas;
create policy cna_select_tec on sgc.assistant_consultas_no_atendidas
  for select to authenticated using (sgc.es_tecnologia());

drop policy if exists cna_update_tec on sgc.assistant_consultas_no_atendidas;
create policy cna_update_tec on sgc.assistant_consultas_no_atendidas
  for update to authenticated using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());

-- ── Registro (lo llama el edge con el JWT del usuario) ───────────────────────
-- SECURITY DEFINER: estampa la identidad real (auth.uid()) y un snapshot de roles,
-- así el registro no depende de que el usuario tenga permiso de insert.
create or replace function sgc.registrar_consulta_no_atendida(
  p_pregunta text,
  p_motivo text,
  p_tool text default null,
  p_detalle text default null,
  p_conversacion_id uuid default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_roles text;
begin
  if coalesce(trim(p_pregunta),'') = '' then return; end if;
  if p_motivo not in ('sin_tool','error_de_tool','sin_permiso') then
    p_motivo := 'sin_tool';
  end if;

  select u.nombre,
         nullif(string_agg(distinct r.nombre, ', '), '')
    into v_nombre, v_roles
  from sgc.usuarios u
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where u.id = v_uid
  group by u.nombre;

  insert into sgc.assistant_consultas_no_atendidas
    (usuario_id, usuario_nombre, roles_snapshot, pregunta, motivo, tool, detalle, conversacion_id)
  values
    (v_uid, v_nombre, v_roles, left(p_pregunta, 1000), p_motivo,
     nullif(p_tool,''), left(nullif(p_detalle,''), 1000), p_conversacion_id);
end;
$$;
grant execute on function sgc.registrar_consulta_no_atendida(text, text, text, text, uuid)
  to authenticated, service_role;

-- ── Panel (Tecnología) — conteos por tipo ───────────────────────────────────
create or replace function sgc.consultas_no_atendidas_conteos()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when sgc.es_tecnologia() then
    jsonb_build_object(
      'total',           count(*),
      'sin_tool',        count(*) filter (where motivo = 'sin_tool'),
      'error_de_tool',   count(*) filter (where motivo = 'error_de_tool'),
      'sin_permiso',     count(*) filter (where motivo = 'sin_permiso'),
      'pendientes',      count(*) filter (where not resuelto),
      'ultimos_7d',      count(*) filter (where created_at >= now() - interval '7 days')
    )
  else jsonb_build_object('error','no_autorizado') end
  from sgc.assistant_consultas_no_atendidas;
$$;
grant execute on function sgc.consultas_no_atendidas_conteos() to authenticated, service_role;

-- ── Panel (Tecnología) — listado filtrable ──────────────────────────────────
create or replace function sgc.consultas_no_atendidas_listado(
  p_motivo text default null,
  p_solo_pendientes boolean default false,
  p_limite int default 200
) returns table (
  id uuid, pregunta text, motivo text, tool text, detalle text,
  usuario_nombre text, roles_snapshot text, conversacion_id uuid,
  resuelto boolean, created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select c.id, c.pregunta, c.motivo, c.tool, c.detalle,
         c.usuario_nombre, c.roles_snapshot, c.conversacion_id,
         c.resuelto, c.created_at
  from sgc.assistant_consultas_no_atendidas c
  where sgc.es_tecnologia()
    and (p_motivo is null or c.motivo = p_motivo)
    and (not p_solo_pendientes or not c.resuelto)
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limite, 200), 500));
$$;
grant execute on function sgc.consultas_no_atendidas_listado(text, boolean, int)
  to authenticated, service_role;

-- ── Marcar como resuelto (Tecnología ya construyó la capacidad) ──────────────
create or replace function sgc.consulta_no_atendida_resolver(
  p_id uuid, p_resuelto boolean default true
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.assistant_consultas_no_atendidas
  set resuelto = coalesce(p_resuelto, true),
      resuelto_por = case when p_resuelto then auth.uid() else null end,
      resuelto_at  = case when p_resuelto then now() else null end
  where id = p_id;
end;
$$;
grant execute on function sgc.consulta_no_atendida_resolver(uuid, boolean)
  to authenticated, service_role;

commit;
