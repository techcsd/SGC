-- BQ2 — destinatarios_notificacion: el correo respeta la regla y el silencio  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- CAUSA (regla 7 + 14).  send_push filtra por `notif_permitida` (regla del admin +
-- silencio del usuario).  Las 6 edges de correo mandan a `usuarios_con_modulo(...)`
-- a secas → Eduardo (gerencia→flota) recibe el correo aunque haya silenciado el tipo.
-- El interruptor sólo cuenta si TODOS los emisores lo consultan.
--
-- ARREGLO.  Un ÚNICO RPC que calcula "a quién" para el correo, reutilizando el mismo
-- predicado del servidor (notif_regla_habilitado + notif_pref_usuario), y devuelve
-- TAMBIÉN a los excluidos con el motivo — para que el panel BK1 responda "¿por qué
-- recibió / no recibió X?".  §F-1 (default): el correo respeta AMBOS, salvo los tipos
-- marcados operativos/críticos (notif_tipo.es_operativa) que ignoran el silencio del
-- usuario (nunca la regla del admin).
--
-- NOTA de arquitectura: NO reruteo send_push por aquí en esta migración.  send_push
-- usa notif_permitida (aplica silencio SIEMPRE, también a operativas); routearlo por
-- destinatarios_notificacion cambiaría el push de las operativas = regresión.  La
-- unificación total de push queda como follow-up con decisión propia.  Aditivo.
-- ---------------------------------------------------------------------------------

-- 'email' pasa a ser un canal válido de notif_tipo (para la matriz de Admin).
update sgc.notif_tipo
   set canales = (select array_agg(distinct c) from unnest(canales || array['email']) c)
 where activo and not ('email' = any(canales));

create or replace function sgc.destinatarios_notificacion(
  p_tipo text,
  p_modulo text default null,
  p_usuarios uuid[] default null,
  p_canal text default 'email'
)
returns table (usuario_id uuid, email text, nombre text, excluido_por text)
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_operativa boolean := coalesce((select es_operativa from sgc.notif_tipo where tipo = p_tipo), false);
begin
  return query
  with base as (
    -- Conjunto base: la lista explícita si viene; si no, quien tiene el módulo.
    select distinct u.id, u.email::text as email, u.nombre::text as nombre
    from sgc.usuarios u
    where u.activo
      and (
        (p_usuarios is not null and u.id = any(p_usuarios))
        or (p_usuarios is null and p_modulo is not null and exists (
              select 1 from sgc.usuarios_roles ur
              join sgc.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id
                and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos))))
      )
  ),
  reglas as (
    -- La regla ganadora por usuario (misma prioridad que notif_regla_habilitado):
    -- usuario > rol > global; entre empates de rol, gana la más restrictiva.
    select b.id,
           (select case
                     when nr.usuario_id is not null then 'regla_usuario'
                     when nr.rol is not null        then 'regla_rol'
                     else 'regla_global'
                   end
              from sgc.notif_regla nr
             where nr.tipo = p_tipo
               and (
                 nr.usuario_id = b.id
                 or (nr.usuario_id is null and nr.rol is null)
                 or (nr.usuario_id is null and nr.rol is not null and exists (
                       select 1 from sgc.usuarios_roles ur
                       join sgc.roles ro on ro.id = ur.rol_id
                       where ur.usuario_id = b.id and ro.codigo = nr.rol))
               )
               and nr.habilitado = false
             order by (nr.usuario_id is not null) desc, (nr.rol is not null) desc
             limit 1) as regla_bloquea
    from base b
  )
  select b.id, b.email, b.nombre,
         case
           -- 1) la regla del admin (global/rol/usuario) siempre manda.
           when coalesce(sgc.notif_regla_habilitado(b.id, p_tipo), true) = false
             then coalesce(r.regla_bloquea, 'regla_global')
           -- 2) el silencio del usuario, salvo tipos operativos/críticos (§F-1).
           when not v_operativa and exists (
                  select 1 from sgc.notif_pref_usuario np
                  where np.usuario_id = b.id and np.tipo = p_tipo and np.silenciado)
             then 'pref_usuario'
           else null
         end as excluido_por
  from base b
  left join reglas r on r.id = b.id;
end;
$function$;

grant execute on function sgc.destinatarios_notificacion(text,text,uuid[],text) to authenticated, service_role;
