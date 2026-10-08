-- 2026-10-08-ck4-conduce-asignar-receptor.sql
-- CK4 — "Entregar a": asignar/cambiar DESPUÉS de crear el conduce quién recibe en la obra.
-- Hoy el receptor designado (firma pendiente, AT16) solo se elige al crear; si no se
-- eligió, la confirmación pide el nombre a mano y no queda ligado a un usuario.
-- Aditivo: nueva tabla de auditoría + RPC. `asignar_firma_pendiente` NO se toca (alta).
--   node scripts/apply-migration.mjs sql/2026-10-08-ck4-conduce-asignar-receptor.sql --env dev

begin;

-- ── Auditoría de cambios de receptor ────────────────────────────────────────────
create table if not exists sgc.conduce_receptor_cambios (
  id          uuid primary key default gen_random_uuid(),
  salida_id   uuid not null references sgc.salidas_inventario(id) on delete cascade,
  de_usuario  uuid references sgc.usuarios(id),
  a_usuario   uuid not null references sgc.usuarios(id),
  por         uuid references sgc.usuarios(id),
  forzado     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_conduce_receptor_cambios_salida on sgc.conduce_receptor_cambios(salida_id);
alter table sgc.conduce_receptor_cambios enable row level security;

-- Lectura: quien puede ver el conduce (elevado o creador); escritura solo por el RPC DEFINER.
drop policy if exists conduce_receptor_cambios_sel on sgc.conduce_receptor_cambios;
create policy conduce_receptor_cambios_sel on sgc.conduce_receptor_cambios
  for select to authenticated
  using (
    sgc.es_flota_elevado()
    or exists (select 1 from sgc.salidas_inventario s
               where s.id = salida_id and s.creado_por = auth.uid())
  );

grant select on sgc.conduce_receptor_cambios to authenticated, service_role;

-- ── RPC: asignar/cambiar receptor ───────────────────────────────────────────────
create or replace function sgc.conduce_asignar_receptor(
  p_salida_id uuid, p_usuario_id uuid, p_forzar boolean default false)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_s         sgc.salidas_inventario%rowtype;
  v_elevado   boolean := sgc.es_flota_elevado();
  v_es_conf   boolean;           -- el elegido es confirmador válido de la obra
  v_prev      uuid;
  v_nombre    text;
  v_obra      text;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  if p_usuario_id is null then
    raise exception 'Indica a quién se le entrega.' using errcode = '22023';
  end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.' using errcode = '22023'; end if;

  -- Permiso: flota elevada (admin/logística/jefe de flota/gerencia/dirección) o el creador.
  if not (v_elevado or v_s.creado_por = v_uid) then
    raise exception 'Tu rol no puede asignar quién recibe este conduce.' using errcode = '42501';
  end if;

  -- Estado: solo mientras no se haya confirmado la recepción y no esté anulado.
  if v_s.anulado_por is not null then
    raise exception 'Este conduce está anulado.' using errcode = '22023';
  end if;
  if v_s.recibido_en is not null then
    raise exception 'Este conduce ya tiene la recepción confirmada: no se puede cambiar quién recibe.' using errcode = '22023';
  end if;

  -- El elegido debe estar activo.
  if not exists (select 1 from sgc.usuarios u where u.id = p_usuario_id and coalesce(u.activo, true)) then
    raise exception 'Ese usuario ya no está activo. Elige otro.' using errcode = '22023';
  end if;

  -- ¿Es confirmador válido para esa obra? (los de receptores_disponibles)
  select exists (
    select 1 from sgc.receptores_disponibles(v_s.proyecto_id, v_s.bodega_id) rd
    where rd.id = p_usuario_id
  ) into v_es_conf;

  if not v_es_conf then
    -- Fuera de la obra: solo elevados y con confirmación explícita (p_forzar).
    if not (v_elevado and p_forzar) then
      raise exception 'Esa persona no está vinculada a la obra del conduce. Un rol elevado puede asignarla igual confirmando (forzar).'
        using errcode = '22023';
    end if;
  end if;

  -- Alto valor: no se puede auto-recibir (debe confirmarlo el responsable en obra).
  if p_usuario_id = v_uid and sgc.conduce_tiene_alto_valor(p_salida_id) then
    raise exception 'Este conduce lleva artículos de alto valor: la recepción la confirma el responsable en obra (no puedes asignártela a ti mismo).'
      using errcode = '22023';
  end if;

  v_prev := v_s.firma_pendiente_usuario_id;
  if v_prev is not distinct from p_usuario_id then
    return; -- sin cambio
  end if;

  select u.nombre into v_nombre from sgc.usuarios u where u.id = p_usuario_id;
  select p.nombre into v_obra from sgc.proyectos p where p.id = v_s.proyecto_id;

  update sgc.salidas_inventario
     set firma_pendiente_usuario_id = p_usuario_id,
         firma_pendiente_nombre     = v_nombre
   where id = p_salida_id;

  insert into sgc.conduce_receptor_cambios (salida_id, de_usuario, a_usuario, por, forzado)
  values (p_salida_id, v_prev, p_usuario_id, v_uid, (not v_es_conf));

  -- Avisos: al nuevo y, si había uno antes, al anterior.
  perform sgc.notificar(p_usuario_id, 'firma',
    'Te asignaron una entrega por confirmar',
    'Debes confirmar la entrega del conduce' || coalesce(' en ' || v_obra, '') || '.',
    '/transporte/por-firmar');

  if v_prev is not null then
    perform sgc.notificar(v_prev, 'firma',
      'Ya no confirmas una entrega',
      'Otra persona confirmará el conduce' || coalesce(' en ' || v_obra, '') || '.',
      '/transporte/por-firmar');
  end if;
end;
$function$;

grant execute on function sgc.conduce_asignar_receptor(uuid, uuid, boolean) to authenticated, service_role;

commit;
