-- ============================================================================
-- DA3/DA11 (PROMPT-122, ronda DA, 27-oct-2026) — Inventario tecnológico,
-- FASE 3: Kits (CONTEXTO-ACTUALIZACION-60.md §1 nota 5.3, DA-10).
--
-- Un equipo "kit" (padre) agrupa componentes (hijos), cada uno con su propia
-- serie/estado/condición/fotos/notas y subcódigo (TEC-0016-01…), y "presente"
-- indica si el componente está físicamente en el kit o falta. El kit NO se
-- carga con datos reales en esta migración (los 7 del kit DJI los carga
-- Xaviel con el lote del conector, F6).
--
-- Aditivo, idempotente. Regla 18: dev primero.
-- Apply: node scripts/apply-migration.mjs sql/2026-10-27-da3-kits.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Columnas de kit ──────────────────────────────────────────────────────
alter table sgc.tec_equipos
  add column if not exists kit_padre_id uuid references sgc.tec_equipos(id) on delete set null,
  add column if not exists presente     boolean not null default true;
comment on column sgc.tec_equipos.kit_padre_id is
  'DA-10 — si no es null, este equipo es un COMPONENTE del kit (equipo padre). Un solo nivel: el padre no puede tener su propio kit_padre_id (trigger). Borrar el padre no borra el componente (ON DELETE SET NULL) — pasa a suelto.';
comment on column sgc.tec_equipos.presente is
  'DA-10 — para componentes de kit: si está físicamente presente o falta (ej. el dron del kit DJI, paradero por confirmar). Para equipos sueltos no se usa (queda true).';

-- Un solo nivel: nadie puede ser hijo de un componente que a su vez es hijo.
create or replace function sgc.tg_tec_equipos_kit_un_nivel()
returns trigger language plpgsql as $$
declare v_abuelo uuid;
begin
  if new.kit_padre_id is not null then
    if new.kit_padre_id = new.id then
      perform sgc.error_campo('kit_padre_id', 'auto_referencia', 'Un equipo no puede ser su propio kit.');
    end if;
    select kit_padre_id into v_abuelo from sgc.tec_equipos where id = new.kit_padre_id;
    if v_abuelo is not null then
      perform sgc.error_campo('kit_padre_id', 'kit_de_dos_niveles', 'Ese equipo ya es un componente de otro kit — un componente no puede tener sus propios componentes.');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tec_equipos_kit_un_nivel on sgc.tec_equipos;
create trigger trg_tec_equipos_kit_un_nivel
  before insert or update on sgc.tec_equipos
  for each row execute function sgc.tg_tec_equipos_kit_un_nivel();

-- ── (2) Subcódigo por componente (extiende DA9) ─────────────────────────────
-- NOTA de concurrencia: el conteo de hermanos para el subíndice NO es atómico
-- (a diferencia de la secuencia de equipos sueltos). Aceptable: los componentes
-- de un kit se crean uno a la vez desde la pantalla (no hay alta masiva
-- concurrente de piezas de UN MISMO kit); si el lote del conector (F6) llega a
-- crear componentes del mismo kit en paralelo, deberá serializarlos.
create or replace function sgc.tg_tec_equipos_asignar_codigo()
returns trigger language plpgsql as $$
declare
  v_codigo_padre text;
  v_n int;
begin
  if new.codigo is not null then
    return new;
  end if;
  if new.kit_padre_id is not null then
    select codigo into v_codigo_padre from sgc.tec_equipos where id = new.kit_padre_id;
    if v_codigo_padre is null then
      new.codigo := 'TEC-' || lpad(nextval('sgc.tec_equipo_seq')::text, 4, '0');
      return new;
    end if;
    select count(*) + 1 into v_n from sgc.tec_equipos where kit_padre_id = new.kit_padre_id;
    new.codigo := v_codigo_padre || '-' || lpad(v_n::text, 2, '0');
  else
    new.codigo := 'TEC-' || lpad(nextval('sgc.tec_equipo_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
-- (el trigger BEFORE INSERT ya existe desde DA1; create or replace basta)

-- ── (3) Tipo "Kit" en el catálogo ────────────────────────────────────────────
insert into sgc.tec_equipo_tipos (clave, label, orden, grupos_campos)
values ('kit', 'Kit (equipo con componentes)', 5, '{}')
on conflict (clave) do nothing;

-- ── (4) Vista: estado calculado del kit ──────────────────────────────────────
create or replace view sgc.tec_kits_estado as
select
  p.id as kit_id,
  p.codigo as kit_codigo,
  p.nombre as kit_nombre,
  count(h.id) as total_componentes,
  count(h.id) filter (where h.presente) as presentes,
  count(h.id) filter (where not h.presente) as faltantes,
  (count(h.id) filter (where not h.presente) = 0) as completo
from sgc.tec_equipos p
join sgc.tec_equipos h on h.kit_padre_id = p.id
group by p.id, p.codigo, p.nombre;

grant select on sgc.tec_kits_estado to authenticated;

-- ── (5) RPC: mover el kit completo (cascada a componentes presentes) ───────
create or replace function sgc.tec_kit_mover(
  p_kit_id uuid, p_empleado_id uuid, p_bodega_id uuid, p_ubicacion text, p_motivo text default null
)
returns void
language plpgsql security invoker set search_path to 'sgc','pg_temp'
as $function$
declare v_es_kit boolean;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  select exists(select 1 from sgc.tec_equipos where kit_padre_id = p_kit_id) into v_es_kit;
  if not v_es_kit then
    perform sgc.error_campo('kit_id', 'sin_componentes', 'Este equipo no tiene componentes — no es un kit.');
  end if;

  update sgc.tec_equipos
     set empleado_id = p_empleado_id, bodega_id = p_bodega_id, ubicacion = coalesce(p_ubicacion, ubicacion)
   where id = p_kit_id;

  update sgc.tec_equipos
     set empleado_id = p_empleado_id, bodega_id = p_bodega_id, ubicacion = coalesce(p_ubicacion, ubicacion)
   where kit_padre_id = p_kit_id and presente = true;

  if p_motivo is not null then
    insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id, usuario_id)
    values (p_kit_id, 'asignacion', format('Kit movido completo: %s', p_motivo), p_empleado_id, auth.uid());
  end if;
end;
$function$;
grant execute on function sgc.tec_kit_mover(uuid, uuid, uuid, text, text) to authenticated;

-- ── (6) RPC: mover/soltar una pieza suelta ──────────────────────────────────
create or replace function sgc.tec_kit_mover_pieza(
  p_componente_id uuid, p_quitar_del_kit boolean default false,
  p_empleado_id uuid default null, p_bodega_id uuid default null, p_motivo text default null
)
returns void
language plpgsql security invoker set search_path to 'sgc','pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  update sgc.tec_equipos
     set kit_padre_id = case when p_quitar_del_kit then null else kit_padre_id end,
         empleado_id  = coalesce(p_empleado_id, empleado_id),
         bodega_id    = coalesce(p_bodega_id, bodega_id)
   where id = p_componente_id;

  insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id, usuario_id)
  values (
    p_componente_id, 'asignacion',
    case when p_quitar_del_kit then coalesce('Salió del kit. ' || p_motivo, 'Salió del kit.')
         else coalesce('Movido dentro/fuera del kit. ' || p_motivo, 'Movido.') end,
    p_empleado_id, auth.uid()
  );
end;
$function$;
grant execute on function sgc.tec_kit_mover_pieza(uuid, boolean, uuid, uuid, text) to authenticated;

-- ── (7) Historial — añade kit_padre_id/presente a lo que ya cubría DA2 ─────
create or replace function sgc.tg_tec_equipos_historial()
returns trigger language plpgsql as $$
declare
  v_cambios text[] := '{}';
  v_tipo text := 'edicion';
  v_usuario uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id, usuario_id)
    values (new.id, 'asignacion',
      case when new.kit_padre_id is not null then format('Componente de kit registrado (situación: %s).', coalesce(new.estado, '—'))
           else format('Equipo registrado (situación: %s).', coalesce(new.estado, '—')) end,
      new.empleado_id, v_usuario);
    return new;
  end if;

  if new.estado is distinct from old.estado then
    v_cambios := v_cambios || format('Situación: %s → %s.',
      coalesce((select label from sgc.tec_equipo_estados where clave = old.estado), old.estado, '—'),
      coalesce((select label from sgc.tec_equipo_estados where clave = new.estado), new.estado, '—'));
    v_tipo := 'estado';
  end if;
  if new.condicion is distinct from old.condicion then
    v_cambios := v_cambios || format('Condición: %s → %s.',
      coalesce((select label from sgc.tec_equipo_condiciones where clave = old.condicion), old.condicion, '—'),
      coalesce((select label from sgc.tec_equipo_condiciones where clave = new.condicion), new.condicion, '—'));
    if v_tipo = 'edicion' then v_tipo := 'estado'; end if;
  end if;
  if new.empleado_id is distinct from old.empleado_id then
    v_cambios := v_cambios || (case when new.empleado_id is null then 'Desasignado (sin empleado).' else 'Reasignado a un empleado.' end)::text;
    v_tipo := 'asignacion';
  end if;
  if new.responsable_externo is distinct from old.responsable_externo then
    v_cambios := v_cambios || (case when new.responsable_externo is null then 'Sin responsable externo.' else format('Responsable externo: %s.', new.responsable_externo) end)::text;
    if v_tipo = 'edicion' then v_tipo := 'asignacion'; end if;
  end if;
  if new.bodega_id is distinct from old.bodega_id or new.ubicacion is distinct from old.ubicacion then
    v_cambios := v_cambios || 'Cambió de ubicación/bodega.'::text;
    if v_tipo = 'edicion' then v_tipo := 'ubicacion'; end if;
  end if;
  if new.costo is distinct from old.costo then
    v_cambios := v_cambios || format('Costo: %s → %s.', coalesce(old.costo::text, '—'), coalesce(new.costo::text, '—'));
  end if;
  if new.kit_padre_id is distinct from old.kit_padre_id then
    v_cambios := v_cambios || (case when new.kit_padre_id is null then 'Salió del kit (ahora es un equipo suelto).' else 'Entró a formar parte de un kit.' end)::text;
    if v_tipo = 'edicion' then v_tipo := 'asignacion'; end if;
  end if;
  if new.presente is distinct from old.presente then
    v_cambios := v_cambios || (case when new.presente then 'Marcado presente en el kit.' else 'Marcado como faltante en el kit.' end)::text;
  end if;
  if new.activo is distinct from old.activo and new.activo = false then
    v_cambios := v_cambios || 'Dado de baja.'::text;
    v_tipo := 'baja';
  end if;

  if array_length(v_cambios, 1) > 0 then
    insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, empleado_id, usuario_id)
    values (new.id, v_tipo, array_to_string(v_cambios, ' '),
            coalesce(new.empleado_id, old.empleado_id), v_usuario);
  end if;
  return new;
end;
$$;

commit;
