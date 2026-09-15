-- ============================================================================
-- PROMPT-50 (BQ) — BQ4 (cont.): aviso al ENCARGADO de la bodega destino cuando
-- un conduce queda "por confirmar".  Ronda 15/09/2026.
-- Aditivo, idempotente, retrocompatible.
--
-- Hoy la recepción es 100% pull (badge `mis_entregas_por_confirmar`): nadie
-- recibe un aviso cuando llega mercancía a una bodega.  BQ4 añadió
-- `bodegas.encargado_id`; aquí lo cableamos:
--
--   * Emisión = UN trigger AFTER UPDATE sobre `salidas_inventario`, con la MISMA
--     condición exacta que abre el badge (estado entregado/entregado_incompleto,
--     recibido_por NULL, destino es una bodega).  Un solo punto ⇒ cubre TODOS los
--     RPCs que entregan (entregar_conduce, conduce_marcar_entregado, …) sin
--     instrumentar cada uno (regla 13: trigger que escribe = escritor inventariado).
--
--   * Destinatarios (encargado-primero, módulo-como-respaldo):
--       - si la bodega destino TIENE encargado → se avisa SÓLO al encargado (el
--         responsable directo).  `notificar_usuarios` es insensible a es_operativo,
--         así que El flaco (rol `encargado_patio`, es_operativo=true, excluido por
--         `notificar_modulo`) sí recibe el aviso.
--       - si la bodega NO tiene encargado → se avisa al módulo `inventario` como
--         respaldo, para que el conduce no quede sin dueño (y crea presión sana
--         para asignar encargado).
--
--   * Tipo `conduce_por_confirmar` ya existe (seed bg2) y es es_operativa=true
--     (crítico ⇒ ignora silencio del usuario; sí respeta la regla del admin).
--
-- Nota de arquitectura (regla 7): la decisión de Xaviel fue "encargado primero,
-- luego al módulo".  El smoke mostró que "módulo" = ~18 avisos INSILENCIABLES por
-- conduce (el tipo es crítico) → se implementa el módulo como RESPALDO (sólo si no
-- hay encargado), no como copia siempre: 1 aviso al responsable en vez de 18 al
-- equipo entero.  Para volver a "siempre al módulo", cambiar el `else` por dos
-- `perform` incondicionales.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-15-bq4-aviso-encargado-conduce.sql
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Primitivo reutilizable: notificar a una lista explícita de usuarios.
-- Espeja el cuerpo de notificar_modulo (in_app + push, respeta notif_permitida),
-- pero sobre un array de ids en vez de por módulo.  Insensible a es_operativo del
-- rol (aquí el destinatario es directo, no por pertenencia a módulo).
-- ---------------------------------------------------------------------------
create or replace function sgc.notificar_usuarios(
  p_usuarios uuid[], p_tipo text, p_titulo text, p_mensaje text,
  p_ruta text default null, p_referencia_id uuid default null, p_referencia_tipo text default null
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if p_usuarios is null or array_length(p_usuarios, 1) is null then return; end if;

  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_id, referencia_tipo)
  select u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta, p_referencia_id, p_referencia_tipo
  from sgc.usuarios u
  where u.activo and u.id = any(p_usuarios)
    and sgc.notif_permitida(u.id, coalesce(p_tipo,'info'));

  perform sgc.send_push(
    (select array_agg(u.id) from sgc.usuarios u where u.activo and u.id = any(p_usuarios)),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta,
      'referencia_id', p_referencia_id, 'referencia_tipo', p_referencia_tipo));
end $$;
grant execute on function sgc.notificar_usuarios(uuid[],text,text,text,text,uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trigger: al abrirse la ventana "por confirmar" de un conduce con destino bodega.
-- ---------------------------------------------------------------------------
create or replace function sgc.trg_conduce_por_confirmar()
returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare
  v_enc uuid;
  v_bodega text;
  v_titulo text;
  v_mensaje text;
  v_ruta text;
begin
  -- Sólo la transición que ABRE el badge, y sólo si el destino es una bodega.
  if not (new.estado in ('entregado','entregado_incompleto')
          and new.recibido_por is null
          and old.estado is distinct from new.estado
          and new.destino_almacen_id is not null
          and not coalesce(new.es_prueba, false)) then
    return new;
  end if;

  select b.encargado_id, b.nombre into v_enc, v_bodega
    from sgc.bodegas b where b.id = new.destino_almacen_id;

  v_titulo  := 'Conduce por confirmar';
  v_mensaje := 'Llegó mercancía a ' || coalesce(v_bodega, 'la bodega') || '. Confírmala cuando la recibas.';
  v_ruta    := '/inventario/conduces';

  if v_enc is not null then
    -- Bodega con encargado: avisa SÓLO al responsable directo.
    perform sgc.notificar_usuarios(array[v_enc], 'conduce_por_confirmar', v_titulo, v_mensaje,
                                   v_ruta, new.id, 'salida');
  else
    -- Sin encargado: respaldo al módulo inventario (que no quede sin dueño).
    perform sgc.notificar_modulo('inventario', 'conduce_por_confirmar', v_titulo, v_mensaje,
                                 v_ruta, new.id, 'salida');
  end if;

  return new;
end $$;

drop trigger if exists trg_conduce_por_confirmar on sgc.salidas_inventario;
create trigger trg_conduce_por_confirmar
  after update on sgc.salidas_inventario
  for each row execute function sgc.trg_conduce_por_confirmar();

commit;
