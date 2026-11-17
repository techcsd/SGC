-- DS-07 (parte 2) / issue #19: homologacion de CATEGORIAS y UNIDADES DE MEDIDA con PROPUESTA + APROBACION HUMANA. ADITIVA.
-- Misma regla que el catalogo de productos: se propone por similitud, una persona decide, y SOLO al aprobar se escribe el vinculo
-- (categorias_inventario.odoo_id / unidades.odoo_id; esos campos son identidad reservada al integrador, por eso lo hace una funcion definer).
-- Rechazar solo marca la propuesta. Reversa: drop function sgc.odoo_maestro_propuesta_decidir(uuid,boolean); drop table sgc.odoo_homologacion_maestros;
create table if not exists sgc.odoo_homologacion_maestros (
  id uuid primary key default gen_random_uuid(),
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  tipo text not null check (tipo in ('categoria','unidad')),
  sgc_id integer not null,
  odoo_id bigint not null check (odoo_id > 0),
  nombre_odoo text not null,
  detalle_odoo text,            -- categoria: ruta completa; unidad: categoria de medida de Odoo (kg, longitud, ...)
  datos jsonb not null default '{}'::jsonb,   -- factor / tipo de la unidad de Odoo (informativo; no se aplica solo)
  metodo text not null check (metodo in ('nombre','sinonimo','similitud')),
  score numeric(4,3) not null check (score between 0 and 1),
  estado text not null default 'propuesta' check (estado in ('propuesta','aprobada','rechazada')),
  decidido_por uuid references sgc.usuarios(id),
  decidido_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (odoo_instancia_id, tipo, sgc_id, odoo_id)
);
create index if not exists odoo_homol_maestros_estado_ix on sgc.odoo_homologacion_maestros(tipo, estado, score desc);
alter table sgc.odoo_homologacion_maestros enable row level security;
drop policy if exists odoo_homol_maestros_leer on sgc.odoo_homologacion_maestros;
create policy odoo_homol_maestros_leer on sgc.odoo_homologacion_maestros for select to authenticated
  using ((select sgc.is_admin()) or (select sgc.tiene_modulo('compras')) or (select sgc.es_tecnologia()));
grant select on sgc.odoo_homologacion_maestros to authenticated;
grant all on sgc.odoo_homologacion_maestros to service_role;

create or replace function sgc.odoo_maestro_propuesta_decidir(p_id uuid, p_aprobar boolean)
returns jsonb language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare p sgc.odoo_homologacion_maestros; v_otro integer; v_ok boolean;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o un administrador puede decidir homologaciones' using errcode = '42501';
  end if;
  select * into p from sgc.odoo_homologacion_maestros where id = p_id for update;
  if not found then raise exception 'Propuesta no encontrada' using errcode = 'P0002'; end if;
  if p.estado <> 'propuesta' then raise exception 'Esta propuesta ya fue decidida' using errcode = '22023'; end if;
  if p_aprobar then
    if p.tipo = 'categoria' then
      select id into v_otro from sgc.categorias_inventario where odoo_instancia_id = p.odoo_instancia_id and odoo_id = p.odoo_id and id <> p.sgc_id;
      if v_otro is not null then raise exception 'Esa categoría de Odoo ya está vinculada a otra categoría de SGC' using errcode = '23505'; end if;
      update sgc.categorias_inventario set odoo_instancia_id = p.odoo_instancia_id, odoo_id = p.odoo_id, odoo_ultima_sync = now()
       where id = p.sgc_id and (odoo_id is null or odoo_id = p.odoo_id);
      v_ok := found;
    else
      select id into v_otro from sgc.unidades where odoo_instancia_id = p.odoo_instancia_id and odoo_id = p.odoo_id and id <> p.sgc_id;
      if v_otro is not null then raise exception 'Esa unidad de Odoo ya está vinculada a otra unidad de SGC' using errcode = '23505'; end if;
      update sgc.unidades set odoo_instancia_id = p.odoo_instancia_id, odoo_id = p.odoo_id, odoo_ultima_sync = now()
       where id = p.sgc_id and (odoo_id is null or odoo_id = p.odoo_id);
      v_ok := found;
    end if;
    if not v_ok then raise exception 'El registro de SGC ya está vinculado a otro elemento de Odoo (o no existe)' using errcode = '23505'; end if;
  end if;
  update sgc.odoo_homologacion_maestros set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    decidido_por = auth.uid(), decidido_en = now() where id = p_id returning * into p;
  return to_jsonb(p);
end $fn$;
revoke all on function sgc.odoo_maestro_propuesta_decidir(uuid, boolean) from public, anon;
grant execute on function sgc.odoo_maestro_propuesta_decidir(uuid, boolean) to authenticated, service_role;
