-- BR4 — Rechazar una recepción desde el detalle (regla 15: "así como puedo confirmarlo,
-- debo poder rechazarlo desde ahí"). Nota #31 + captura 4 (entrada Torre Alpha, origen
-- "Ferretería test", Artículos (0), PENDIENTE DE CONFIRMACIÓN con solo "Confirmar recepción").
--
-- Entradas usan `pendiente_confirmacion` (bool): mientras está pendiente NO se ha movido
-- stock (el detalle se materializa al confirmar) → rechazar es limpio, no revierte nada.
-- Salidas usan un CHECK de estado → se añade 'rechazada'. La salida ya despachó stock al
-- crearse; rechazar la recepción es una disputa que no toca stock (se corrige/re-confirma
-- o se anula por separado).

begin;

-- 1) Columnas de rechazo (ambas tablas) -----------------------------------------
alter table sgc.entradas_inventario
  add column if not exists rechazada boolean not null default false,
  add column if not exists rechazada_por uuid references sgc.usuarios(id),
  add column if not exists rechazada_at timestamptz,
  add column if not exists rechazo_motivo text,
  add column if not exists rechazo_foto_path text,
  add column if not exists entrada_origen_id uuid references sgc.entradas_inventario(id);

alter table sgc.salidas_inventario
  add column if not exists rechazada_por uuid references sgc.usuarios(id),
  add column if not exists rechazada_at timestamptz,
  add column if not exists rechazo_motivo text,
  add column if not exists rechazo_foto_path text;

-- 2) CHECK de estado de salidas: + 'rechazada' (regla 3) ------------------------
alter table sgc.salidas_inventario drop constraint if exists salidas_inventario_estado_check;
alter table sgc.salidas_inventario add constraint salidas_inventario_estado_check
  check (estado = any (array['despachado'::text, 'entregado'::text, 'entregado_incompleto'::text, 'anulado'::text, 'rechazada'::text]));

-- 3) notif_tipo — recepcion_rechazada -------------------------------------------
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('recepcion_rechazada', 'Recepción rechazada', 'El receptor rechazó una entrada/entrega; corregir y reenviar.', true, array['in_app','push'], true, 63)
on conflict (tipo) do nothing;

-- 4) RPC — rechazar_recepcion (gate = quien puede confirmar) ---------------------
create or replace function sgc.rechazar_recepcion(p_tipo text, p_id uuid, p_motivo text, p_foto_path text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_emisor uuid;
  v_codigo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  -- Mismo predicado que confirmar (presencial o remoto).
  if not (sgc.is_admin() or sgc.puede_confirmar_recepcion() or sgc.puede_confirmar_remoto()) then
    raise exception 'Sin permiso para rechazar recepción' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'El motivo del rechazo es obligatorio' using errcode = '22023';
  end if;

  if p_tipo = 'entrada' then
    declare e record;
    begin
      select * into e from sgc.entradas_inventario where id = p_id;
      if e.id is null then raise exception 'Entrada no encontrada'; end if;
      if coalesce(e.rechazada, false) then raise exception 'Esta entrada ya fue rechazada'; end if;
      if not coalesce(e.pendiente_confirmacion, false) then
        raise exception 'Esta entrada ya fue confirmada; para revertirla usa la anulación (mueve stock).';
      end if;
      -- No mueve stock: al estar pendiente, el detalle nunca se materializó.
      update sgc.entradas_inventario
         set rechazada = true, pendiente_confirmacion = false,
             rechazada_por = v_uid, rechazada_at = now(),
             rechazo_motivo = btrim(p_motivo), rechazo_foto_path = nullif(p_foto_path,'')
       where id = p_id;
      v_emisor := coalesce(e.creado_por, e.registrado_por);
      v_codigo := 'ENT-' || upper(left(p_id::text, 8));
    end;
  elsif p_tipo = 'salida' then
    declare s record;
    begin
      select * into s from sgc.salidas_inventario where id = p_id;
      if s.id is null then raise exception 'Conduce/salida no encontrado'; end if;
      if s.estado = 'rechazada' then raise exception 'Esta entrega ya fue rechazada'; end if;
      if s.estado = 'anulado' then raise exception 'Esta salida está anulada'; end if;
      -- No mueve stock (el despacho ya salió del origen; el rechazo es una disputa).
      update sgc.salidas_inventario
         set estado = 'rechazada',
             rechazada_por = v_uid, rechazada_at = now(),
             rechazo_motivo = btrim(p_motivo), rechazo_foto_path = nullif(p_foto_path,'')
       where id = p_id;
      v_emisor := s.creado_por;
      v_codigo := 'CND-' || upper(left(p_id::text, 8));
    end;
  else
    raise exception 'Tipo inválido (entrada|salida)';
  end if;

  -- Avisa al emisor: corregir y reenviar (regla 15 corolario).
  if v_emisor is not null and v_emisor <> v_uid then
    perform sgc.notificar_usuarios(array[v_emisor], 'recepcion_rechazada',
      'Recepción rechazada',
      format('%s fue rechazada: %s. Corrígela y reenvíala.', v_codigo, btrim(p_motivo)),
      case when p_tipo = 'entrada' then '/inventario/entradas' else '/inventario/conduces' end,
      p_id, p_tipo);
  end if;

  return jsonb_build_object('ok', true, 'tipo', p_tipo, 'id', p_id);
end $function$;

grant execute on function sgc.rechazar_recepcion(text, uuid, text, text) to authenticated;

commit;
