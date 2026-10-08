-- 2026-10-08-ck10-probar-notificacion.sql
-- CK10 — "Probar notificación" (Perfil) + lectura de entregas por usuario (admin).
-- El arreglo del canal/sonido vive en la edge send-push y en la app (canal v2). Aquí
-- va la parte SQL: un RPC que se manda un push a sí mismo (sin service role en el
-- cliente) y las lecturas de `notif_entregas` para diagnosticar "no me llegó".
--   node scripts/apply-migration.mjs sql/2026-10-08-ck10-probar-notificacion.sql --env dev

begin;

-- Manda un push de prueba al usuario en sesión. Ignora la matriz de silencios a
-- propósito (es una prueba: queremos que suene aunque el tipo esté silenciado) usando
-- p_tipo => null en send_push. Devuelve cuántos dispositivos activos tiene el usuario
-- (el resultado real de entrega se lee después en notif_entregas, pues el envío es async).
create or replace function sgc.probar_notificacion()
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  select count(*) into v_n from sgc.device_tokens dt where dt.usuario_id = v_uid and dt.activo;
  -- p_tipo null => send_push no filtra por la matriz de notificaciones.
  perform sgc.send_push(
    array[v_uid],
    'Prueba de notificación',
    'Si ves y escuchas esto, tus avisos están activos. Si no sonó, toca Activar.',
    jsonb_build_object('ruta', '/configuracion'),
    null);
  return jsonb_build_object('dispositivos', v_n);
end;
$function$;

grant execute on function sgc.probar_notificacion() to authenticated, service_role;

-- Las últimas entregas del propio usuario (para ver el resultado de "Probar notificación").
create or replace function sgc.mis_notif_entregas(p_limite int default 10)
returns table(canal text, tipo text, titulo text, estado text, motivo text, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select e.canal, e.tipo, e.titulo, e.estado, e.motivo, e.created_at
    from sgc.notif_entregas e
   where e.usuario_id = auth.uid()
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limite, 10), 50));
$function$;

grant execute on function sgc.mis_notif_entregas(int) to authenticated, service_role;

-- "Entregas por usuario" (web Admin › Notificaciones): últimos N intentos de un
-- usuario con estado/motivo/token corto. Solo admin o tecnología.
create or replace function sgc.notif_entregas_de_usuario(p_usuario_id uuid, p_limite int default 50)
returns table(canal text, tipo text, titulo text, destino text, estado text, motivo text, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select e.canal, e.tipo, e.titulo, e.destino, e.estado, e.motivo, e.created_at
    from sgc.notif_entregas e
   where (sgc.is_admin() or sgc.es_tecnologia())
     and e.usuario_id = p_usuario_id
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limite, 50), 200));
$function$;

grant execute on function sgc.notif_entregas_de_usuario(uuid, int) to authenticated, service_role;

commit;
