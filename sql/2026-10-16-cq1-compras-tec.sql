-- ============================================================================
-- CQ1 (16/10/2026): Compras tecnológicas — rediseño de alta + lectura automática
-- de la cotización.
--
-- Xaviel: "lets improve the Compras tecnologicas module, first of all the way
-- the articles gonna be filled need an update and improve, and the cotization
-- maded for it must be uploadable to the system in this new compra tecnologica
-- requested" — confirmó que además quiere que el sistema LEA la cotización
-- subida (PDF/foto) y llene los artículos; el usuario solo revisa/corrige.
--
-- ADITIVA: nuevas columnas nullable / con DEFAULT (no rompe el flujo normal de
-- Compras ni filas históricas). Las funciones `crear_solicitud_compra_tec` y
-- `compra_tec_adjuntar_cotizacion` se DROPEAN y recrean con más parámetros
-- (todos los nuevos con DEFAULT) en vez de usar solo CREATE OR REPLACE, porque
-- agregar parámetros con CREATE OR REPLACE crea un OVERLOAD nuevo en lugar de
-- reemplazar (gotcha ya documentado — CH1/BN1b: terminó en overloads
-- ambiguos). Drop+create dentro de la misma transacción evita ese problema.
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) solicitudes_compra — campos del encabezado nuevo ─────────────────────
alter table sgc.solicitudes_compra
  add column if not exists titulo text,
  add column if not exists urgencia text default 'normal',
  add column if not exists itbis_incluido boolean default false,
  add column if not exists subtotal numeric,
  add column if not exists itbis numeric,
  add column if not exists total numeric;

alter table sgc.solicitudes_compra drop constraint if exists solicitudes_compra_urgencia_check;
alter table sgc.solicitudes_compra add constraint solicitudes_compra_urgencia_check
  check (urgencia is null or urgencia = any (array['normal','urgente']));

-- ── 2) solicitud_compra_adjuntos — lo que la lectura automática devuelve ────
alter table sgc.solicitud_compra_adjuntos
  add column if not exists fecha date,
  add column if not exists lectura jsonb,
  add column if not exists lectura_costo_usd numeric;

-- ── 3) crear_solicitud_compra_tec — ahora acepta título/urgencia/obra/ITBIS y
--      calcula subtotal/itbis/total EN EL SERVIDOR a partir de los renglones
--      (nunca confía en el total que mande el cliente — regla 3, integridad). ─
drop function if exists sgc.crear_solicitud_compra_tec(text, jsonb);
create or replace function sgc.crear_solicitud_compra_tec(
  p_notas text,
  p_items jsonb,
  p_titulo text default null,
  p_urgencia text default 'normal',
  p_proyecto_id uuid default null,
  p_itbis_incluido boolean default false
)
returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare
  v_id uuid;
  v_suma numeric;
  v_subtotal numeric;
  v_itbis numeric;
  v_total numeric;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('tecnologia')) then
    raise exception 'No autorizado para crear compras tecnológicas.';
  end if;

  select coalesce(sum((i->>'cantidad')::numeric * coalesce(nullif(i->>'precio_unitario','')::numeric, 0)), 0)
    into v_suma
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  if coalesce(p_itbis_incluido, false) then
    v_total := v_suma;
    v_subtotal := round(v_suma / 1.18, 2);
    v_itbis := v_total - v_subtotal;
  else
    v_subtotal := v_suma;
    v_itbis := round(v_subtotal * 0.18, 2);
    v_total := v_subtotal + v_itbis;
  end if;

  insert into sgc.solicitudes_compra
    (proyecto_id, solicitante_id, estado, notas, categoria, titulo, urgencia, itbis_incluido, subtotal, itbis, total)
  values
    (p_proyecto_id, auth.uid(), 'borrador', p_notas, 'tecnologia', nullif(trim(p_titulo), ''),
     coalesce(nullif(p_urgencia, ''), 'normal'), coalesce(p_itbis_incluido, false), v_subtotal, v_itbis, v_total)
  returning id into v_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, foto_path, precio_unitario, unidad)
  select v_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido', i->>'foto_path',
         nullif(i->>'precio_unitario', '')::numeric, nullif(i->>'unidad', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  return v_id;
end;
$$;
grant execute on function sgc.crear_solicitud_compra_tec(text, jsonb, text, text, uuid, boolean) to authenticated;

-- ── 4) compra_tec_actualizar_borrador — EDITAR mientras está en 'borrador'.
--      Mismo patrón que la de crear: recalcula subtotal/itbis/total en server,
--      y reemplaza los renglones (borra + reinserta, patrón ya usado en el
--      repo para listas hijas de un borrador). ───────────────────────────────
create or replace function sgc.compra_tec_actualizar_borrador(
  p_id uuid,
  p_notas text,
  p_titulo text,
  p_urgencia text,
  p_proyecto_id uuid,
  p_itbis_incluido boolean,
  p_items jsonb
)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare
  v_sol sgc.solicitudes_compra%rowtype;
  v_suma numeric;
  v_subtotal numeric;
  v_itbis numeric;
  v_total numeric;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia' for update;
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if v_sol.estado <> 'borrador' then
    raise exception 'Solo se puede editar mientras está en borrador.';
  end if;

  select coalesce(sum((i->>'cantidad')::numeric * coalesce(nullif(i->>'precio_unitario','')::numeric, 0)), 0)
    into v_suma
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  if coalesce(p_itbis_incluido, false) then
    v_total := v_suma;
    v_subtotal := round(v_suma / 1.18, 2);
    v_itbis := v_total - v_subtotal;
  else
    v_subtotal := v_suma;
    v_itbis := round(v_subtotal * 0.18, 2);
    v_total := v_subtotal + v_itbis;
  end if;

  update sgc.solicitudes_compra set
    notas = p_notas,
    titulo = nullif(trim(p_titulo), ''),
    urgencia = coalesce(nullif(p_urgencia, ''), 'normal'),
    proyecto_id = p_proyecto_id,
    itbis_incluido = coalesce(p_itbis_incluido, false),
    subtotal = v_subtotal,
    itbis = v_itbis,
    total = v_total,
    updated_at = now()
  where id = p_id;

  delete from sgc.solicitud_compra_items where solicitud_id = p_id;
  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, foto_path, precio_unitario, unidad)
  select p_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido', i->>'foto_path',
         nullif(i->>'precio_unitario', '')::numeric, nullif(i->>'unidad', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;
end;
$$;
grant execute on function sgc.compra_tec_actualizar_borrador(uuid, text, text, text, uuid, boolean, jsonb) to authenticated;

-- ── 5) compra_tec_adjuntar_cotizacion — ahora guarda lo que leyó la IA ──────
drop function if exists sgc.compra_tec_adjuntar_cotizacion(uuid, text, text, numeric, text, text);
create or replace function sgc.compra_tec_adjuntar_cotizacion(
  p_id uuid,
  p_tipo text,
  p_proveedor text,
  p_monto numeric,
  p_path text,
  p_nombre text,
  p_fecha date default null,
  p_lectura jsonb default null,
  p_lectura_costo_usd numeric default null
)
returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol sgc.solicitudes_compra%rowtype; v_adj_id uuid; v_primera boolean;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia';
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  select not exists(select 1 from sgc.solicitud_compra_adjuntos where solicitud_id = p_id) into v_primera;
  insert into sgc.solicitud_compra_adjuntos
    (solicitud_id, tipo, proveedor, monto, path, nombre, subido_por, elegida, fecha, lectura, lectura_costo_usd)
  values
    (p_id, coalesce(nullif(p_tipo, ''), 'cotizacion'), p_proveedor, p_monto, p_path, p_nombre, auth.uid(), v_primera,
     p_fecha, p_lectura, p_lectura_costo_usd)
  returning id into v_adj_id;
  return v_adj_id;
end;
$$;
grant execute on function sgc.compra_tec_adjuntar_cotizacion(uuid, text, text, numeric, text, text, date, jsonb, numeric) to authenticated;

-- ── 6) Parámetros de límite para la edge `leer-cotizacion` (mismo patrón que
--      CF4 `leer_recibo_limite_*`; editables en Config, con default si faltan). ─
insert into sgc.parametros (clave, valor, descripcion) values
  ('leer_cotizacion_limite_diario_global', '200', 'CQ1 — máximo de lecturas de cotización por día en todo el sistema.'),
  ('leer_cotizacion_limite_usuario_hora',  '20',  'CQ1 — máximo de lecturas de cotización por usuario por hora.')
on conflict (clave) do nothing;

commit;
