-- ============================================================================
-- Actualización 3 · S4 (bloque por actividad) + S7 (equipos retirar/dañados +
-- notificación dirigida por rol). Solo DDL + helpers; los RPC se re-crean en
-- 2026-07-21-act3-rpc-bitacora.sql.
-- Aditivo / idempotente / retrocompatible.
-- ============================================================================
set search_path = sgc, public;

-- ── S4) Bloque por línea de actividad ───────────────────────────────────────
-- La cabecera `bitacoras.bloque_entrepiso` se mantiene por compatibilidad; esta
-- columna permite que cada actividad diga en qué bloque/piso/edificio se hizo
-- (multi-bloque de la app). Nullable → filas viejas quedan sin bloque.
alter table sgc.bitacora_actividades add column if not exists bloque text;
comment on column sgc.bitacora_actividades.bloque is
  'Bloque/piso/edificio de la actividad (S4 multi-bloque). Nullable para filas legacy.';

-- ── S7) Equipos alquilados: retirar / dañados ───────────────────────────────
alter table sgc.bitacora_equipos_alquilados
  add column if not exists para_retirar boolean not null default false,
  add column if not exists danado       boolean not null default false,
  add column if not exists dano_detalle text;
comment on column sgc.bitacora_equipos_alquilados.para_retirar is 'Equipo marcado para retiro (notifica al transportista).';
comment on column sgc.bitacora_equipos_alquilados.danado       is 'Equipo reportado como dañado (notifica a flota elevados).';

-- ── S7) Helper: notificar por rol (espejo de notificar_modulo) ──────────────
-- Inserta una notificación para cada usuario activo que tenga el rol p_rol
-- (por codigo). SECURITY DEFINER; se llama desde RPC definer, por eso no se
-- otorga a authenticated (igual criterio que notificar_modulo).
create or replace function sgc.notificar_rol(
  p_rol text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language sql
security definer
set search_path to 'sgc','pg_temp'
as $$
  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo and r.codigo = p_rol;
$$;
revoke execute on function sgc.notificar_rol(text,text,text,text,text) from authenticated;
grant  execute on function sgc.notificar_rol(text,text,text,text,text) to service_role;

-- ── S7) Helper: notificar a flota elevados ──────────────────────────────────
-- Mismos roles que sgc.es_flota_elevado() pero en modo broadcast (no auth.uid).
create or replace function sgc.notificar_flota_elevado(
  p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language sql
security definer
set search_path to 'sgc','pg_temp'
as $$
  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  select distinct u.id, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo and r.codigo in ('admin','direccion','gerencia','jefe_flota');
$$;
revoke execute on function sgc.notificar_flota_elevado(text,text,text,text) from authenticated;
grant  execute on function sgc.notificar_flota_elevado(text,text,text,text) to service_role;
