-- AF5 — El chofer solo debe ver notificaciones referentes a SU usuario.
--
-- Causa raíz (investigada en el repo): NO es una fuga de RLS. La política
-- `notif_sel` de sgc.notificaciones ya filtra por `usuario_id = auth.uid()`.
-- El problema es el fan-out de sgc.notificar_modulo(): inserta una fila REAL
-- por CADA usuario activo cuyo rol tenga el módulo (o el comodín 'admin').
-- El rol "Chofer / Transportista" tiene modulos = {flota, inventario, transporte},
-- así que TODA alerta de flota/inventario (consumo anormal, mantenimiento vencido,
-- pre-uso con hallazgos, etc. — todas supervisoras) le cae al chofer. RLS luego
-- se las devuelve correctamente → "ve todas las notificaciones".
--
-- Fix (aditivo, retrocompatible): los roles OPERATIVOS de campo (chofer) no reciben
-- broadcasts de módulo; solo reciben notificaciones per-usuario (sgc.notificar()).
-- Se marca el rol como operativo con una bandera configurable; el resto de roles
-- (oficina/supervisión) siguen recibiendo los broadcasts exactamente igual.
--
-- Verificado: los ~30 call-sites de notificar_modulo son todos alertas de
-- supervisión (flota/direccion), ninguna es crítica para el chofer.

-- ── 1) Bandera de rol operativo de campo (configurable) ─────────────────────
alter table sgc.roles add column if not exists es_operativo boolean not null default false;
comment on column sgc.roles.es_operativo is
  'AF5 — rol de campo (chofer): NO recibe broadcasts de módulo (notificar_modulo), solo notificaciones per-usuario. Gating de módulos intacto.';

update sgc.roles set es_operativo = true where nombre = 'Chofer / Transportista';

-- ── 2) notificar_modulo excluye a quien SOLO tiene roles operativos ─────────
-- Un usuario recibe el broadcast si tiene al menos un rol NO operativo que
-- conceda el módulo (o el comodín 'admin'). El chofer puro queda fuera; un
-- usuario que además tenga un rol de oficina lo sigue recibiendo por ese rol.
create or replace function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language sql security definer set search_path to 'sgc', 'pg_temp' as $$
  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  select u.id, coalesce(p_tipo, 'info'), p_titulo, p_mensaje, p_ruta
  from sgc.usuarios u
  where u.activo
    and exists (
      select 1
      from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id
        and not coalesce(r.es_operativo, false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos))
    );
$$;
-- El grant/revoke previo se conserva (flota-v2-fixes revocó a authenticated;
-- solo funciones security-definer / service_role la invocan).
grant execute on function sgc.notificar_modulo(text, text, text, text, text) to service_role;
