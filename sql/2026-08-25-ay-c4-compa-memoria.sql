-- ============================================================================
-- AY C4 — Memoria de Compa por usuario (COMPA-V2 §3-C4).
--
-- Que Compa recuerde entre conversaciones lo operativo del usuario (obra por
-- defecto, preferencias de formato, a quién suele asignar). Memoria PROPIA en BD
-- (no la memory tool client-side de Anthropic): respeta el mismo modelo de
-- permisos y auditoría que todo lo demás — cada quien ve/gestiona SOLO la suya,
-- y es borrable.
-- ============================================================================

begin;
set local search_path = sgc, public;

create table if not exists sgc.assistant_memory (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references sgc.usuarios(id) on delete cascade,
  clave      text not null,
  valor      text not null,
  updated_at timestamptz not null default now(),
  unique (usuario_id, clave)
);
create index if not exists idx_assistant_memory_usuario on sgc.assistant_memory (usuario_id);

alter table sgc.assistant_memory enable row level security;

drop policy if exists assistant_memory_rw on sgc.assistant_memory;
create policy assistant_memory_rw on sgc.assistant_memory
  for all using (usuario_id = auth.uid() or sgc.is_admin())
  with check (usuario_id = auth.uid() or sgc.is_admin());

grant select, insert, update, delete on sgc.assistant_memory to authenticated;

-- Upsert de una memoria del propio usuario (lo llama la tool `recordar`).
create or replace function sgc.recordar_memoria(p_clave text, p_valor text)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_clave,'')),'') is null or nullif(trim(coalesce(p_valor,'')),'') is null then
    raise exception 'Clave y valor son requeridos.';
  end if;
  insert into sgc.assistant_memory (usuario_id, clave, valor, updated_at)
  values (auth.uid(), trim(p_clave), trim(p_valor), now())
  on conflict (usuario_id, clave) do update set valor = excluded.valor, updated_at = now();
end;
$$;
grant execute on function sgc.recordar_memoria(text, text) to authenticated, service_role;

commit;
