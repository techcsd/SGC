-- 2026-10-08-cj12-choferes-privados.sql
-- CJ12 — Sección Flota › Choferes privados: lista + autorizar vehículos en lote.
-- Aditivo. Gate flota elevado (es_flota_elevado / is_admin).
--   node scripts/apply-migration.mjs sql/2026-10-08-cj12-choferes-privados.sql --env dev

-- ── Lista de choferes privados con su estado ─────────────────────────────────────
create or replace function sgc.listar_choferes_privados()
returns table(
  usuario_id uuid, nombre text, cedula text, telefono text,
  autorizadas jsonb, en_uso jsonb, ultimo_uso_at timestamptz, n_autorizadas int)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    u.id,
    u.nombre::text,
    coalesce(c.cedula, u.cedula)::text,
    coalesce(c.telefono, u.telefono)::text,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'autorizacion_id', a.id, 'vehiculo_id', a.vehiculo_id, 'placa', v.placa,
        'marca', v.marca, 'modelo', v.modelo, 'desde', a.desde, 'hasta', a.hasta) order by v.placa)
      from sgc.vehiculo_autorizaciones a
      join sgc.vehiculos v on v.id = a.vehiculo_id
      where a.usuario_id = u.id and a.activa
        and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date)
    ), '[]'::jsonb) as autorizadas,
    (select jsonb_build_object('vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
            'modelo', v.modelo, 'desde', vu.inicio_at)
       from sgc.vehiculo_usos vu join sgc.vehiculos v on v.id = vu.vehiculo_id
      where vu.usuario_id = u.id and vu.fin_at is null limit 1) as en_uso,
    (select max(vu.inicio_at) from sgc.vehiculo_usos vu where vu.usuario_id = u.id) as ultimo_uso_at,
    (select count(*)::int from sgc.vehiculo_autorizaciones a
      where a.usuario_id = u.id and a.activa
        and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date)) as n_autorizadas
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id and r.codigo = 'chofer_privado'
  left join sgc.conductores c on c.usuario_id = u.id
  where (sgc.is_admin() or sgc.es_flota_elevado())
  order by u.nombre;
$function$;
grant execute on function sgc.listar_choferes_privados() to authenticated;

-- ── Autorizar varios vehículos de una vez a un chofer privado ────────────────────
create or replace function sgc.autorizar_vehiculos_privado_lote(
  p_usuario uuid, p_vehiculos uuid[], p_desde date default current_date,
  p_hasta date default null, p_nota text default null)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_v uuid; v_n int := 0;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_usuario is null then raise exception 'Falta el usuario.'; end if;
  foreach v_v in array coalesce(p_vehiculos, array[]::uuid[]) loop
    perform sgc.autorizar_vehiculo_privado(p_usuario, v_v, p_desde, p_hasta, p_nota);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
grant execute on function sgc.autorizar_vehiculos_privado_lote(uuid, uuid[], date, date, text) to authenticated;
