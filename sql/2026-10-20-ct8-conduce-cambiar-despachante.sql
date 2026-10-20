-- 2026-10-20-ct8-conduce-cambiar-despachante.sql — CT8 (fila 268)
-- Raykler reportó que no hay forma de corregir "Despachado por" en un conduce
-- (CND-B3EA7DC2: Jonathan Roman quedó como despachante por error humano, con
-- firma pendiente, y Raykler no puede ni cerrar el conduce mientras falte esa
-- firma). Hoy el despachante solo se fija al crear/emitir (AI2) — no existe
-- ninguna RPC para cambiarlo después. "Entregar a" (CK4, conduce_asignar_
-- receptor) ya resuelve el mismo problema para el receptor; este migración
-- replica el mismo patrón (tabla de auditoría + RPC DEFINER + avisos) para el
-- despachante (rol 'emisor' en sgc.salida_firmas).
begin;

create table if not exists sgc.conduce_despachante_cambios (
  id           uuid primary key default gen_random_uuid(),
  salida_id    uuid not null references sgc.salidas_inventario(id) on delete cascade,
  de_usuario   uuid references sgc.usuarios(id),
  de_empleado  uuid references sgc.empleados(id),
  de_nombre    text,
  a_usuario    uuid references sgc.usuarios(id),
  a_empleado   uuid references sgc.empleados(id),
  a_nombre     text,
  por          uuid references sgc.usuarios(id),
  tenia_firma  boolean not null default false,
  motivo       text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_conduce_despachante_cambios_salida on sgc.conduce_despachante_cambios(salida_id);
alter table sgc.conduce_despachante_cambios enable row level security;

drop policy if exists conduce_despachante_cambios_sel on sgc.conduce_despachante_cambios;
create policy conduce_despachante_cambios_sel on sgc.conduce_despachante_cambios
  for select to authenticated
  using (
    sgc.es_flota_elevado()
    or exists (select 1 from sgc.salidas_inventario s
               where s.id = salida_id and s.creado_por = auth.uid())
  );
grant select on sgc.conduce_despachante_cambios to authenticated, service_role;

create or replace function sgc.conduce_cambiar_despachante(
  p_salida_id uuid,
  p_despachante_nombre text default null,
  p_despachante_usuario_id uuid default null,
  p_despachante_empleado_id uuid default null,
  p_motivo text default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_elevado boolean := sgc.es_flota_elevado();
  v_tenia_firma boolean;
  v_prev_usuario uuid;
  v_prev_empleado uuid;
  v_prev_nombre text;
  v_nuevo_nombre text;
  v_obra text;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_despachante_nombre, '')), '') is null
     and p_despachante_usuario_id is null and p_despachante_empleado_id is null then
    raise exception 'Indica quién despachó.' using errcode = '22023';
  end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.' using errcode = '22023'; end if;

  -- Mismo universo que "Entregar a" (CK4): flota elevada o quien creó el conduce.
  if not (v_elevado or v_s.creado_por = v_uid) then
    raise exception 'Tu rol no puede cambiar quién despachó este conduce.' using errcode = '42501';
  end if;
  if v_s.anulado_por is not null then
    raise exception 'Este conduce está anulado.' using errcode = '22023';
  end if;

  v_tenia_firma := exists (select 1 from sgc.salida_firmas where salida_id = p_salida_id and rol = 'emisor');
  if v_tenia_firma then
    if not sgc.is_admin() then
      raise exception 'El despachante anterior ya firmó: solo un administrador puede cambiarlo.' using errcode = '42501';
    end if;
    if nullif(trim(coalesce(p_motivo, '')), '') is null then
      raise exception 'Da un motivo para cambiar un despachante que ya firmó.' using errcode = '22023';
    end if;
    -- La firma anterior deja de ser válida para el nuevo despachante; se pedirá de nuevo al cerrar.
    delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'emisor';
  end if;

  v_prev_usuario := v_s.despachante_usuario_id;
  v_prev_empleado := v_s.despachante_empleado_id;
  v_prev_nombre := v_s.despachante_nombre;

  if p_despachante_usuario_id is not null then
    select nombre into v_nuevo_nombre from sgc.usuarios where id = p_despachante_usuario_id;
  elsif p_despachante_empleado_id is not null then
    select nombre into v_nuevo_nombre from sgc.empleados where id = p_despachante_empleado_id;
  else
    v_nuevo_nombre := nullif(trim(p_despachante_nombre), '');
  end if;

  update sgc.salidas_inventario set
    despachante_nombre = v_nuevo_nombre,
    despachante_usuario_id = p_despachante_usuario_id,
    despachante_empleado_id = p_despachante_empleado_id
  where id = p_salida_id;

  insert into sgc.conduce_despachante_cambios
    (salida_id, de_usuario, de_empleado, de_nombre, a_usuario, a_empleado, a_nombre, por, tenia_firma, motivo)
  values
    (p_salida_id, v_prev_usuario, v_prev_empleado, v_prev_nombre,
     p_despachante_usuario_id, p_despachante_empleado_id, v_nuevo_nombre, v_uid, v_tenia_firma, nullif(trim(p_motivo), ''));

  select p.nombre into v_obra from sgc.proyectos p where p.id = v_s.proyecto_id;

  if p_despachante_usuario_id is not null and p_despachante_usuario_id is distinct from v_prev_usuario then
    perform sgc.notificar(p_despachante_usuario_id, 'firma',
      'Te asignaron como despachante',
      'Debes firmar la salida del conduce' || coalesce(' en ' || v_obra, '') || '.',
      '/transporte/por-firmar');
  end if;
  if v_prev_usuario is not null and v_prev_usuario is distinct from p_despachante_usuario_id then
    perform sgc.notificar(v_prev_usuario, 'firma',
      'Ya no eres el despachante de este conduce',
      'Se cambió quién despachó el conduce' || coalesce(' en ' || v_obra, '') || '.',
      '/transporte/por-firmar');
  end if;
end;
$$;
grant execute on function sgc.conduce_cambiar_despachante(uuid, text, uuid, uuid, text) to authenticated;

commit;
