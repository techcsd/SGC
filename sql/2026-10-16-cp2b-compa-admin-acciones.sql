-- CP2b — acciones del admin desde "Conversaciones de Compa": guardar un mensaje
-- problemático como caso de prueba (backlog para curar en evals/casos.json) y
-- enviarlo a Consultas de Compa (el backlog de BE2) cuando el admin encuentra
-- un gap a mano que el modelo no reportó solo.

create table if not exists sgc.compa_casos_prueba (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid references sgc.assistant_conversaciones(id) on delete set null,
  mensaje_id      uuid references sgc.assistant_mensajes(id) on delete set null,
  mensaje         text not null,
  nota            text,
  creado_por      uuid not null default auth.uid() references sgc.usuarios(id),
  created_at      timestamptz not null default now(),
  curado          boolean not null default false
);
alter table sgc.compa_casos_prueba enable row level security;
drop policy if exists "compa_casos_prueba: admin" on sgc.compa_casos_prueba;
create policy "compa_casos_prueba: admin" on sgc.compa_casos_prueba for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());
grant select, insert, update on sgc.compa_casos_prueba to authenticated;

create or replace function sgc.compa_guardar_caso_prueba(p_conversacion_id uuid, p_mensaje_id uuid, p_mensaje text, p_nota text default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid;
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into sgc.compa_casos_prueba (conversacion_id, mensaje_id, mensaje, nota)
  values (p_conversacion_id, p_mensaje_id, p_mensaje, p_nota)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.compa_guardar_caso_prueba(uuid, uuid, text, text) to authenticated;

create or replace function sgc.compa_enviar_a_consultas(p_conversacion_id uuid, p_pregunta text, p_motivo text default 'sin_tool')
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id uuid;
  v_usuario uuid;
  v_nombre text;
  v_roles text;
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select c.usuario_id, u.nombre::text into v_usuario, v_nombre
    from sgc.assistant_conversaciones c join sgc.usuarios u on u.id = c.usuario_id
   where c.id = p_conversacion_id;
  select string_agg(r.nombre, ', ') into v_roles
    from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
   where ur.usuario_id = v_usuario;

  insert into sgc.assistant_consultas_no_atendidas
    (usuario_id, usuario_nombre, roles_snapshot, pregunta, motivo, conversacion_id, detalle)
  values (v_usuario, v_nombre, v_roles, p_pregunta,
          case when p_motivo in ('sin_tool','error_de_tool','sin_permiso') then p_motivo else 'sin_tool' end,
          p_conversacion_id, 'Enviado a mano desde Conversaciones de Compa (CP2)')
  returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.compa_enviar_a_consultas(uuid, text, text) to authenticated;
