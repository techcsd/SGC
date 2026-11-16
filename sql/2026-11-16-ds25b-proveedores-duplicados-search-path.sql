-- DS-25b: proveedores_duplicados necesita `extensions` en el search_path (operador % de pg_trgm).

-- Posibles duplicados: nombre parecido (pg_trgm >= umbral) o mismo RNC (>= 9 digitos). Cada par una sola vez.
create or replace function sgc.proveedores_duplicados(p_umbral numeric default null)
returns table (a_id uuid, a_nombre text, a_mov bigint, a_ratificado boolean, b_id uuid, b_nombre text, b_mov bigint, b_ratificado boolean, similitud numeric, mismo_rnc boolean)
language plpgsql stable security definer set search_path = sgc, extensions, public, pg_temp as $fn$
declare v_u numeric;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No tienes acceso a la curación de proveedores.' using errcode = '42501'; end if;
  select coalesce(p_umbral, nullif((select valor from sgc.parametros where clave = 'proveedores_duplicados_umbral'), '')::numeric, 0.6) into v_u;
  perform set_config('pg_trgm.similarity_threshold', v_u::text, true);
  return query
    select a.id, a.nombre::text, coalesce(ma.movimientos, 0), a.ratificado_en is not null,
           b.id, b.nombre::text, coalesce(mb.movimientos, 0), b.ratificado_en is not null,
           round(similarity(lower(a.nombre), lower(b.nombre))::numeric, 2),
           (length(regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g')) >= 9
            and regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g') = regexp_replace(coalesce(b.rnc, ''), '\D', '', 'g'))
      from sgc.proveedores a
      join sgc.proveedores b on a.id < b.id
        and (lower(a.nombre) % lower(b.nombre)
             or (length(regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g')) >= 9
                 and regexp_replace(coalesce(a.rnc, ''), '\D', '', 'g') = regexp_replace(coalesce(b.rnc, ''), '\D', '', 'g')))
      left join sgc.v_proveedores_movimiento ma on ma.proveedor_id = a.id
      left join sgc.v_proveedores_movimiento mb on mb.proveedor_id = b.id
     where a.activo and b.activo and coalesce(a.es_prueba, false) = false and coalesce(b.es_prueba, false) = false
     order by 9 desc
     limit 500;
end $fn$;

revoke all on function sgc.proveedores_duplicados(numeric) from public, anon;
grant execute on function sgc.proveedores_duplicados(numeric) to authenticated; -- gatea adentro
