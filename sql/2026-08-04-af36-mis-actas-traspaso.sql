-- AF36 — Historial de recepciones/traspasos de vehículo del usuario (actas). La
-- app no puede unir sgc.usuarios (RLS admin-only); RPC security-definer con los
-- nombres resueltos. La RLS de vehiculo_traspaso_actas ya acota a los involucrados
-- + flota; aquí se replica + se aíslan las de prueba (solo admin). Aditivo.

create or replace function sgc.mis_actas_traspaso()
returns table (
  id                    uuid,
  vehiculo_id           uuid,
  placa                 text,
  km                    int,
  de_usuario_id         uuid,
  de_nombre             text,
  a_usuario_id          uuid,
  a_nombre              text,
  llave1_ubicacion_tipo text,
  fotos                 text[],
  notas                 text,
  created_at            timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select a.id, a.vehiculo_id, v.placa, a.km,
         a.de_usuario_id, ud.nombre, a.a_usuario_id, ua.nombre,
         a.llave1_ubicacion_tipo, a.fotos, a.notas, a.created_at
  from sgc.vehiculo_traspaso_actas a
  left join sgc.vehiculos v on v.id = a.vehiculo_id
  left join sgc.usuarios ud on ud.id = a.de_usuario_id
  left join sgc.usuarios ua on ua.id = a.a_usuario_id
  where (a.a_usuario_id = auth.uid() or a.de_usuario_id = auth.uid()
         or sgc.is_admin() or sgc.tiene_modulo('flota'))
    and (not coalesce(a.es_prueba, false) or sgc.is_admin())
  order by a.created_at desc;
$$;
grant execute on function sgc.mis_actas_traspaso() to authenticated, service_role;
