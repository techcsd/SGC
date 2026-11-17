-- DS-34 (ronda DS, 16-nov-2026) — #58/#74: conduces «por cerrar» (despachados sin recepción).
-- Aditiva. Vista de solo lectura + aviso por edad. SIN auto-cierre (las 28 viejas las limpia el almacén).
-- Los avisos quedan APAGADOS por defecto (conduce_aviso_activo=false): al encenderlos avisan una sola vez
-- por conduce (marcas aviso_*_at). Valores del issue como default: 7 días / recordatorio a las 24 h.
--   node scripts/apply-migration.mjs sql/2026-11-16-ds34-conduces-por-cerrar.sql --env dev
begin;
set local search_path = sgc, public;

insert into sgc.parametros (clave, valor, descripcion) values
  ('conduce_aviso_activo', 'false', 'DS-34/#58: activa los avisos de conduces sin cerrar (apagado hasta confirmar con el almacén).'),
  ('conduce_aviso_dias', '7', 'DS-34/#58: días abiertos para avisar a Central/almacén de un conduce sin cerrar.'),
  ('conduce_recordatorio_horas', '24', 'DS-34/#74: horas abiertas para recordar al despachante/creador (0 = no recordar).'),
  ('conduce_aviso_roles', 'jefe_almacen,admin', 'DS-34/#58: roles que reciben el aviso de conduces sin cerrar (CSV).'),
  ('conduce_qr_activo', 'false', 'DS-34/#74: muestra el QR en el conduce (recibir/firmar/cerrar al escanear). Requiere el secret CONDUCE_QR_SECRET en la edge conduce-qr.'),
  ('conduce_qr_vigencia_dias', '30', 'DS-34/#74: días de vigencia del token del QR del conduce.')
on conflict (clave) do nothing;

alter table sgc.salidas_inventario
  add column if not exists recordatorio_cierre_at timestamptz,
  add column if not exists aviso_por_cerrar_at timestamptz;

-- Vista de solo lectura: despachados sin recepción, más viejos primero. Admin o módulo inventario.
create or replace function sgc.conduces_por_cerrar(p_dias_min int default 0)
returns table (
  id uuid, codigo text, created_at timestamptz, dias_abierto int, estado text,
  despachante text, destino_texto text, tiene_confirmaciones boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select si.id, upper(left(si.id::text, 8)), si.created_at,
         extract(day from now() - si.created_at)::int, si.estado::text,
         coalesce(ud.nombre, uc.nombre)::text, si.destino_texto::text,
         exists (select 1 from sgc.recepcion_confirmaciones rc where rc.entidad_tipo = 'salida' and rc.entidad_id = si.id)
    from sgc.salidas_inventario si
    left join sgc.usuarios ud on ud.id = si.despachante_usuario_id
    left join sgc.usuarios uc on uc.id = si.creado_por
   where (sgc.is_admin() or sgc.tiene_modulo('inventario'))
     and coalesce(si.es_prueba, false) = false
     and coalesce(si.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
     and si.recibido_por is null
     and si.created_at < now() - make_interval(days => greatest(coalesce(p_dias_min, 0), 0))
   order by si.created_at asc
   limit 500;
$$;
grant execute on function sgc.conduces_por_cerrar(int) to authenticated;

-- Aviso por edad (cron diario). service_role. Una vez por etapa y conduce.
create or replace function sgc.conduces_por_cerrar_avisar()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_activo boolean := coalesce((select valor from sgc.parametros where clave = 'conduce_aviso_activo'), 'false') in ('true','t','1','si','sí');
  v_dias   int := coalesce(nullif((select valor from sgc.parametros where clave = 'conduce_aviso_dias'), '')::int, 7);
  v_horas  int := coalesce(nullif((select valor from sgc.parametros where clave = 'conduce_recordatorio_horas'), '')::int, 24);
  v_rec record; v_rol text; v_n int := 0;
begin
  if not v_activo then return 0; end if;

  -- Etapa 1: recordatorio al despachante/creador.
  if v_horas > 0 then
    for v_rec in
      select si.id, upper(left(si.id::text, 8)) as codigo, array_remove(array[si.despachante_usuario_id, si.creado_por], null) as dest
        from sgc.salidas_inventario si
       where coalesce(si.es_prueba, false) = false
         and coalesce(si.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
         and si.recibido_por is null and si.recordatorio_cierre_at is null
         and si.created_at < now() - make_interval(hours => v_horas)
    loop
      perform sgc.notificar_usuarios(v_rec.dest, 'warning', 'Conduce sin cerrar',
        format('El conduce %s sigue abierto. Pide al receptor que escanee su QR o confirme la recepción.', v_rec.codigo),
        '/inventario/salidas/' || v_rec.id || '/conduce', v_rec.id, 'salida');
      update sgc.salidas_inventario set recordatorio_cierre_at = now() where id = v_rec.id;
      v_n := v_n + 1;
    end loop;
  end if;

  -- Etapa 2: aviso a Central/almacén pasados N días.
  for v_rec in
    select si.id, upper(left(si.id::text, 8)) as codigo, extract(day from now() - si.created_at)::int as dias
      from sgc.salidas_inventario si
     where coalesce(si.es_prueba, false) = false
       and coalesce(si.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
       and si.recibido_por is null and si.aviso_por_cerrar_at is null
       and si.created_at < now() - make_interval(days => greatest(v_dias, 1))
  loop
    foreach v_rol in array sgc.param_csv('conduce_aviso_roles', 'jefe_almacen,admin') loop
      perform sgc.notificar_rol(v_rol, 'warning', 'Conduce sin cerrar',
        format('El conduce %s lleva %s días sin cierre. Revísalo o anúlalo con motivo.', v_rec.codigo, v_rec.dias),
        '/inventario/pendientes-cierre');
    end loop;
    update sgc.salidas_inventario set aviso_por_cerrar_at = now() where id = v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
revoke execute on function sgc.conduces_por_cerrar_avisar() from public, anon, authenticated;
grant execute on function sgc.conduces_por_cerrar_avisar() to service_role;

do $$ begin perform cron.unschedule('sgc-conduces-por-cerrar'); exception when others then null; end $$;
select cron.schedule('sgc-conduces-por-cerrar', '30 11 * * *', $cron$select sgc.conduces_por_cerrar_avisar();$cron$);
commit;
