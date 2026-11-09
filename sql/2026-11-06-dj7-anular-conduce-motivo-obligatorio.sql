-- Issue #58 (sub-pieza acotada): sgc.anular_conduce acepta p_motivo=null/vacio --
-- 56 de 60 anulaciones (93%) no tienen motivo_anulacion. Misma regla que #57
-- (dj3): minimo 10 caracteres, un motivo real, no relleno. Resto del body SIN
-- TOCAR (reversion de stock, ruta/parada, auditoria central, aviso al chofer
-- -- copiado tal cual de sql/2026-08-14-aq10-aq12-anular-conduce-confirmaciones-central.sql,
-- solo se agrega la validacion del motivo al inicio). El resto de #58
-- (significado de 'entregado_incompleto', barrido de despachados >14 dias)
-- queda fuera -- necesita decision de negocio, ver docs/PLAN-ISSUES-ABIERTOS-2026-11.md.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

create or replace function sgc.anular_conduce(p_salida_id uuid, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_s       sgc.salidas_inventario%rowtype;
  v_es_admin boolean := sgc.is_admin();
  r         record;
  v_otras   int;
  v_chofer_usuario uuid;
begin
  -- Issue #58: motivo obligatorio y real (mismo umbral que #57/dj3).
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'El motivo de la anulación debe tener al menos 10 caracteres.' using errcode = '22023';
  end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then
    raise exception 'Conduce no encontrado.' using errcode = 'P0002';
  end if;

  -- Autorización: emisor (mientras pendiente) o admin.
  if not (v_es_admin or v_s.creado_por = auth.uid()) then
    raise exception 'No tienes permiso para eliminar este conduce.' using errcode = '42501';
  end if;

  -- Solo pendientes: ni entregado, ni confirmado, ni ya anulado.
  if v_s.recibido_por is not null
     or coalesce(v_s.estado,'') in ('entregado','entregado_incompleto','anulado')
     or exists (select 1 from sgc.recepcion_confirmaciones rc
                where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = v_s.id)
  then
    raise exception 'Este conduce ya no puede eliminarse (ya fue entregado o confirmado).'
      using errcode = 'P0001';
  end if;

  -- Reponer stock: la creación descuenta el origen vía trigger de detalle_salidas
  -- (solo cuando NO es prueba). Como es soft-delete, el trigger DELETE no dispara → se repone aquí.
  if not coalesce(v_s.es_prueba, false) then
    for r in select articulo_id, cantidad from sgc.detalle_salidas where salida_id = v_s.id loop
      perform sgc.adjust_stock(r.articulo_id, v_s.bodega_id, r.cantidad);
    end loop;
  end if;

  -- Ruta vinculada: si este conduce es la única parada activa, se cancela la ruta;
  -- si hay otras, solo se omite esta parada (rutas multi-parada).
  if v_s.ruta_id is not null then
    select count(*) into v_otras
    from sgc.salidas_inventario o
    where o.ruta_id = v_s.ruta_id and o.id <> v_s.id and coalesce(o.estado,'') <> 'anulado';
    if coalesce(v_otras,0) = 0 then
      update sgc.rutas set estado = 'cancelada'
        where id = v_s.ruta_id and estado in ('planificada','en_curso');
    end if;
    if v_s.ruta_parada_id is not null then
      update sgc.ruta_paradas set estado = 'omitida'
        where id = v_s.ruta_parada_id and coalesce(estado,'') <> 'entregada';
    end if;
  end if;

  -- Soft-delete + auditoría en columnas propias.
  update sgc.salidas_inventario
     set estado           = 'anulado',
         anulado_por      = auth.uid(),
         anulado_en       = now(),
         motivo_anulacion = btrim(p_motivo)
   where id = v_s.id;

  -- Auditoría central (para admin).
  insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios, datos_antes, datos_despues)
  values ('salidas_inventario', v_s.id::text, 'DELETE', auth.uid(),
          jsonb_build_object('accion','anular_conduce','motivo', btrim(p_motivo)),
          jsonb_build_object('estado', v_s.estado, 'recibido_por', v_s.recibido_por),
          jsonb_build_object('estado','anulado'));

  -- Avisar al chofer asignado (best-effort; ahora también push por AQ1).
  select usuario_id into v_chofer_usuario from sgc.conductores where id = v_s.conductor_id;
  if v_chofer_usuario is not null then
    perform sgc.notificar(v_chofer_usuario, 'conduce', 'Conduce eliminado',
      'El conduce CND-' || upper(substr(v_s.id::text,1,8)) || ' fue eliminado.', null);
  end if;
end $$;
grant execute on function sgc.anular_conduce(uuid, text) to authenticated, service_role;

commit;
