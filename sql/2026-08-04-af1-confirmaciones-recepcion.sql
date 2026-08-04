-- ============================================================================
-- AF1 / AF2 / AF13 / AF14 / AF15 — Confirmaciones de recepción con evidencia
-- Ronda 03/08/2026 (IDs AF) — PROMPT-1 FASE 1
--
-- Backend transversal COMPARTIDO (web + app): registrar que alguien confirmó
-- la recepción de una entrada / salida / conduce, con:
--   - quién confirmó, cuándo
--   - modo (presencial | remota)
--   - foto(s) de evidencia
--   - notas
--   - checklist de items (cantidades recibidas vs enviadas)
--
-- Permisos de confirmación:
--   - puede_confirmar_recepcion(): admin, módulo inventario, roles de campo
--     (ingeniero_campo / guarda_almacen) o el flag por-usuario
--     `can_confirm_reception` (para el CAPATAZ — AF14, que no es un rol).
--   - puede_confirmar_remoto(): admin o el flag `can_confirm_remote` (AF15,
--     Raykler y Eduardo): confirma/firma en obra aunque no esté presente para
--     tirar la foto; la aporta quien esté en obra.
--
-- Todo aditivo, idempotente y retrocompatible. No rompe el flujo antifraude
-- existente (confirmar_entrada_chofer sigue igual: sólo Almacén/Inventario).
-- ============================================================================

-- ── Flags de permiso por usuario ────────────────────────────────────────────
alter table sgc.usuarios add column if not exists can_confirm_reception boolean not null default false;
alter table sgc.usuarios add column if not exists can_confirm_remote    boolean not null default false;
comment on column sgc.usuarios.can_confirm_reception is 'Puede recibir/confirmar entregas en obra (capataz, residente). AF14.';
comment on column sgc.usuarios.can_confirm_remote    is 'Puede confirmar/firmar recepciones de forma remota; la foto la aporta quien está en obra. AF15.';

-- ── Helpers de permiso ──────────────────────────────────────────────────────
create or replace function sgc.puede_confirmar_recepcion()
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or exists (
           select 1 from sgc.usuarios u
           where u.id = auth.uid() and coalesce(u.can_confirm_reception, false)
         )
      or exists (
           select 1 from sgc.usuarios_roles ur
           join sgc.roles r on r.id = ur.rol_id
           where ur.usuario_id = auth.uid()
             and r.codigo in ('ingeniero_campo', 'guarda_almacen')
         );
$$;
grant execute on function sgc.puede_confirmar_recepcion() to authenticated, service_role;

create or replace function sgc.puede_confirmar_remoto()
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (
           select 1 from sgc.usuarios u
           where u.id = auth.uid() and coalesce(u.can_confirm_remote, false)
         );
$$;
grant execute on function sgc.puede_confirmar_remoto() to authenticated, service_role;

-- ── Tabla de confirmaciones (evidencia + auditoría) ─────────────────────────
create table if not exists sgc.recepcion_confirmaciones (
  id             uuid primary key default gen_random_uuid(),
  entidad_tipo   text not null check (entidad_tipo in ('entrada', 'salida', 'conduce')),
  entidad_id     uuid not null,
  confirmado_por uuid not null references sgc.usuarios(id),
  modo           text not null default 'presencial' check (modo in ('presencial', 'remota')),
  aportado_por   uuid references sgc.usuarios(id),   -- quién aportó las fotos en obra (modo remota)
  fecha          timestamptz not null default now(),
  fotos          text[] not null default '{}',       -- paths en bucket 'inventario'
  notas          text,
  checklist      jsonb,                              -- [{articulo_id,nombre,cantidad_enviada,cantidad_recibida,diferencia}]
  es_prueba      boolean not null default false,
  es_prueba_origen text not null default 'manual',
  created_at     timestamptz not null default now()
);
create index if not exists idx_recepcion_conf_entidad on sgc.recepcion_confirmaciones (entidad_tipo, entidad_id);
create index if not exists idx_recepcion_conf_por on sgc.recepcion_confirmaciones (confirmado_por, created_at desc);

alter table sgc.recepcion_confirmaciones enable row level security;

drop policy if exists "recepcion_conf: select" on sgc.recepcion_confirmaciones;
create policy "recepcion_conf: select" on sgc.recepcion_confirmaciones
  for select to authenticated
  using (
    sgc.is_admin()
    or sgc.tiene_modulo('inventario')
    or sgc.tiene_modulo('flota')
    or confirmado_por = auth.uid()
    or aportado_por  = auth.uid()
  );

-- es_prueba oculto a no-admin
drop policy if exists "es_prueba: oculta a no-admin" on sgc.recepcion_confirmaciones;
create policy "es_prueba: oculta a no-admin" on sgc.recepcion_confirmaciones
  as restrictive for select to authenticated
  using (not es_prueba or sgc.is_admin());

grant select on sgc.recepcion_confirmaciones to authenticated;
grant all on sgc.recepcion_confirmaciones to service_role;
-- Inserts sólo vía RPC SECURITY DEFINER (abajo). No se otorga insert directo.

-- ── Grabador genérico de confirmación (compartido) ──────────────────────────
-- Registra la evidencia de confirmación para cualquier entidad. Valida permiso
-- y hereda es_prueba de la entidad referenciada. Devuelve el id de la confirmación.
create or replace function sgc.registrar_confirmacion_recepcion(
  p_entidad_tipo text,
  p_entidad_id   uuid,
  p_modo         text    default 'presencial',
  p_fotos        text[]  default '{}',
  p_notas        text    default null,
  p_checklist    jsonb   default null,
  p_aportado_por uuid    default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_modo text := coalesce(p_modo, 'presencial');
  v_es_prueba boolean := false;
  v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_entidad_tipo not in ('entrada', 'salida', 'conduce') then
    raise exception 'Tipo de entidad inválido: %', p_entidad_tipo;
  end if;
  if v_modo not in ('presencial', 'remota') then
    raise exception 'Modo inválido: %', v_modo;
  end if;

  -- Permiso según el modo.
  if v_modo = 'remota' then
    if not sgc.puede_confirmar_remoto() then
      raise exception 'Sin permiso para confirmación remota';
    end if;
  else
    if not sgc.puede_confirmar_recepcion() then
      raise exception 'Sin permiso para confirmar recepción';
    end if;
  end if;

  -- es_prueba heredado de la entidad.
  if p_entidad_tipo = 'entrada' then
    select coalesce(es_prueba, false) into v_es_prueba from sgc.entradas_inventario where id = p_entidad_id;
  elsif p_entidad_tipo = 'salida' then
    select coalesce(es_prueba, false) into v_es_prueba from sgc.salidas_inventario where id = p_entidad_id;
  end if;

  insert into sgc.recepcion_confirmaciones (
    entidad_tipo, entidad_id, confirmado_por, modo, aportado_por,
    fotos, notas, checklist, es_prueba, es_prueba_origen
  ) values (
    p_entidad_tipo, p_entidad_id, v_uid, v_modo,
    case when v_modo = 'remota' then p_aportado_por else null end,
    coalesce(p_fotos, '{}'), p_notas, p_checklist,
    coalesce(v_es_prueba, false), case when coalesce(v_es_prueba,false) then 'heredado' else 'manual' end
  ) returning id into v_id;

  return v_id;
end;
$$;
grant execute on function sgc.registrar_confirmacion_recepcion(text, uuid, text, text[], text, jsonb, uuid) to authenticated, service_role;

-- ── Confirmar ENTRADA con evidencia (flujo web AF2) ─────────────────────────
-- Supera al botón simple: materializa el stock de una entrada pendiente
-- (misma lógica que confirmar_entrada_chofer) Y registra la evidencia
-- (fotos + checklist + modo). Permisos ampliados: capataz (flag) y remoto.
create or replace function sgc.confirmar_entrada_evidencia(
  p_entrada_id   uuid,
  p_items        jsonb   default null,
  p_fotos        text[]  default '{}',
  p_notas        text    default null,
  p_modo         text    default 'presencial',
  p_aportado_por uuid    default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_modo text := coalesce(p_modo, 'presencial');
  e record;
  v_items jsonb;
  it jsonb;
  v_conf uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Permiso según modo (antifraude: chofer plano NO califica).
  if v_modo = 'remota' then
    if not sgc.puede_confirmar_remoto() then raise exception 'Sin permiso para confirmación remota'; end if;
  else
    if not sgc.puede_confirmar_recepcion() then raise exception 'Sin permiso para confirmar recepción'; end if;
  end if;

  select * into e from sgc.entradas_inventario where id = p_entrada_id;
  if e.id is null then raise exception 'Entrada no encontrada'; end if;

  -- Si sigue pendiente, materializa el detalle (el trigger sube stock).
  if coalesce(e.pendiente_confirmacion, false) then
    v_items := coalesce(p_items, e.items_propuestos, '[]'::jsonb);
    for it in select * from jsonb_array_elements(v_items)
    loop
      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
      values (
        p_entrada_id,
        (it->>'articulo_id')::uuid,
        coalesce((it->>'cantidad')::numeric, 0),
        nullif(it->>'precio_unit', '')::numeric
      );
    end loop;

    update sgc.entradas_inventario
       set pendiente_confirmacion = false, items_propuestos = null
     where id = p_entrada_id;

    if e.orden_compra_id is not null then
      update sgc.ordenes_compra set estado = 'recibida'
       where id = e.orden_compra_id and estado <> 'recibida';
    end if;
  end if;

  -- Evidencia (siempre queda registro de quién/cuándo/fotos).
  v_conf := sgc.registrar_confirmacion_recepcion(
    'entrada', p_entrada_id, v_modo, coalesce(p_fotos, '{}'), p_notas,
    coalesce(p_items, e.items_propuestos), p_aportado_por
  );

  return v_conf;
end;
$$;
grant execute on function sgc.confirmar_entrada_evidencia(uuid, jsonb, text[], text, text, uuid) to authenticated, service_role;

-- ── Lectura: confirmaciones de una entidad (para el detalle) ────────────────
create or replace function sgc.confirmaciones_de(p_entidad_tipo text, p_entidad_id uuid)
returns setof sgc.recepcion_confirmaciones
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select *
  from sgc.recepcion_confirmaciones
  where entidad_tipo = p_entidad_tipo
    and entidad_id = p_entidad_id
    and (not es_prueba or sgc.is_admin())
  order by created_at desc;
$$;
grant execute on function sgc.confirmaciones_de(text, uuid) to authenticated, service_role;

-- ── AF15: asignar confirmación remota a Raykler y Eduardo ───────────────────
-- Identificados por id real (NO se hardcodean nombres en código de app).
update sgc.usuarios set can_confirm_remote = true
where id in (
  '2725c827-aec2-4e0c-90ac-dea1ee2b2350',  -- Eduardo NG
  '7c7ffd84-5c74-48d3-9084-5dad7202857b'   -- Raykler Peña
);
