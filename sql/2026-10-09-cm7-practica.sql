-- 2026-10-09-cm7-practica.sql — CM7 (reglas 18/19) — modo práctica (fundación)
--
-- Lo ÚNICO real que escribe el modo práctica: la nota del intento. Los datos de las
-- misiones son de mentira y viven en el cliente (practica/escenarios/*.json); el servidor
-- solo guarda el resultado. No cuenta en KPIs, incentivos ni avisos.
--
--   node scripts/apply-migration.mjs sql/2026-10-09-cm7-practica.sql --env dev

begin;

-- Catálogo de misiones (versionado; semilla de las web del piloto).
create table if not exists sgc.practica_misiones (
  id         text primary key,
  plataforma text not null check (plataforma in ('web','app')),
  roles      text[] not null default '{}',   -- roles que la ven ('{}' = todos)
  titulo     text not null,
  version    int  not null default 1,
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Intentos (la nota la calcula el cliente: es práctica, no nómina).
create table if not exists sgc.practica_intentos (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  mision_id  text not null,
  version    int  not null default 1,
  nota       numeric not null,
  estrellas  int  not null default 0,
  aprobada   boolean not null default false,
  duracion_s int  not null default 0,
  detalle    jsonb not null default '{}',
  plataforma text not null default 'web',
  created_at timestamptz not null default now()
);
create index if not exists ix_practica_intentos_usuario on sgc.practica_intentos(usuario_id, created_at desc);
create index if not exists ix_practica_intentos_mision on sgc.practica_intentos(mision_id);

alter table sgc.practica_misiones enable row level security;
alter table sgc.practica_intentos enable row level security;

-- Misiones: las lee cualquier autenticado (el cliente filtra por rol).
drop policy if exists practica_misiones_sel on sgc.practica_misiones;
create policy practica_misiones_sel on sgc.practica_misiones
  for select to authenticated using (activa);

-- Intentos: cada uno ve lo suyo; su JEFE (empleados.jefe_id), RRHH y admin ven todo.
drop policy if exists practica_intentos_sel on sgc.practica_intentos;
create policy practica_intentos_sel on sgc.practica_intentos
  for select to authenticated using (
    usuario_id = auth.uid()
    or sgc.is_admin()
    or sgc.tiene_modulo('rrhh')
    or exists (
      select 1 from sgc.empleados sub
      join sgc.empleados jefe on jefe.id = sub.jefe_id
      where sub.usuario_id = practica_intentos.usuario_id and jefe.usuario_id = auth.uid())
  );

-- Guardar un intento (lo llama el cliente de práctica; valida rangos).
create or replace function sgc.practica_guardar_intento(
  p_mision_id text, p_version int, p_nota numeric, p_estrellas int,
  p_aprobada boolean, p_duracion_s int, p_detalle jsonb default '{}', p_plataforma text default 'web')
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_nota < 0 or p_nota > 100 then raise exception 'Nota fuera de rango (0-100)'; end if;
  insert into sgc.practica_intentos (usuario_id, mision_id, version, nota, estrellas, aprobada, duracion_s, detalle, plataforma)
  values (auth.uid(), p_mision_id, coalesce(p_version,1), p_nota,
          greatest(0, least(3, coalesce(p_estrellas,0))), coalesce(p_aprobada,false),
          greatest(0, coalesce(p_duracion_s,0)), coalesce(p_detalle,'{}'), coalesce(nullif(p_plataforma,''),'web'))
  returning id into v_id;
  return v_id;
end $function$;

grant select on sgc.practica_misiones to authenticated;
grant select on sgc.practica_intentos to authenticated;
grant select, insert, update, delete on sgc.practica_misiones to service_role;
grant select, insert, update, delete on sgc.practica_intentos to service_role;
grant execute on function sgc.practica_guardar_intento(text,int,numeric,int,boolean,int,jsonb,text) to authenticated, service_role;

-- Semilla: misiones web del piloto/ronda (idempotente).
insert into sgc.practica_misiones (id, plataforma, roles, titulo, version) values
  ('web-crear-requisicion', 'web', '{}', 'Crear una requisición', 1),
  ('web-aprobar-despachar', 'web', '{}', 'Aprobar y despachar', 1),
  ('web-conduce-receptor',  'web', '{}', 'Emitir un conduce con receptor', 1),
  ('web-transferir-conduce','web', '{}', 'Transferir un conduce', 1),
  ('web-entrada-inventario','web', '{}', 'Registrar una entrada de inventario', 1),
  ('web-conteo',            'web', '{}', 'Hacer un conteo', 1)
on conflict (id) do nothing;

commit;
