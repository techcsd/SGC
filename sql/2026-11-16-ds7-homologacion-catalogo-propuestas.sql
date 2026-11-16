-- DS-07 (ronda DS, 16-nov-2026) / issue #19: homologacion masiva del catalogo con PROPUESTA + APROBACION. ADITIVA.
-- Odoo es el catalogo maestro (ADR 15). Niveles: codigo (default_code = codigo SGC), nombre normalizado, similitud (trigram).
-- Nada vincula un articulo sin aprobacion, salvo el nivel «codigo», que el script marca aprobado de origen.
create table if not exists sgc.odoo_homologacion_propuestas (
  id uuid primary key default gen_random_uuid(),
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  articulo_id uuid not null references sgc.articulos(id) on delete cascade,
  odoo_product_id bigint not null check (odoo_product_id > 0),
  odoo_template_id bigint not null check (odoo_template_id > 0),
  nombre_odoo text not null,
  codigo_odoo text,
  categoria_odoo text,
  uom_odoo text,
  metodo text not null check (metodo in ('codigo','nombre','similitud')),
  score numeric(4,3) not null check (score between 0 and 1),
  estado text not null default 'propuesta' check (estado in ('propuesta','aprobada','rechazada')),
  decidido_por uuid references sgc.usuarios(id),
  decidido_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (odoo_instancia_id, articulo_id, odoo_product_id)
);
create index if not exists odoo_homol_prop_estado_ix on sgc.odoo_homologacion_propuestas(estado, score desc);
alter table sgc.odoo_homologacion_propuestas enable row level security;
drop policy if exists odoo_homol_prop_leer on sgc.odoo_homologacion_propuestas;
create policy odoo_homol_prop_leer on sgc.odoo_homologacion_propuestas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.es_tecnologia());
grant select on sgc.odoo_homologacion_propuestas to authenticated;
grant all on sgc.odoo_homologacion_propuestas to service_role;

-- Aprobar vincula el articulo (identidad reservada al integrador: lo escribe esta funcion definer). Rechazar solo marca.
create or replace function sgc.odoo_propuesta_decidir(p_id uuid, p_aprobar boolean)
returns jsonb language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare p sgc.odoo_homologacion_propuestas; v_otro uuid;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o un administrador puede decidir homologaciones' using errcode = '42501';
  end if;
  select * into p from sgc.odoo_homologacion_propuestas where id = p_id for update;
  if not found then raise exception 'Propuesta no encontrada' using errcode = 'P0002'; end if;
  if p.estado <> 'propuesta' then raise exception 'Esta propuesta ya fue decidida' using errcode = '22023'; end if;
  if p_aprobar then
    select id into v_otro from sgc.articulos where odoo_instancia_id = p.odoo_instancia_id and odoo_product_id = p.odoo_product_id and id <> p.articulo_id;
    if v_otro is not null then raise exception 'Ese producto de Odoo ya está vinculado a otro artículo de SGC' using errcode = '23505'; end if;
    update sgc.articulos set odoo_instancia_id = p.odoo_instancia_id, odoo_product_id = p.odoo_product_id, odoo_template_id = p.odoo_template_id, odoo_ultima_sync = now()
     where id = p.articulo_id and (odoo_product_id is null or odoo_product_id = p.odoo_product_id);
    if not found then raise exception 'El artículo ya está vinculado a otro producto de Odoo' using errcode = '23505'; end if;
  end if;
  update sgc.odoo_homologacion_propuestas set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    decidido_por = auth.uid(), decidido_en = now() where id = p_id returning * into p;
  return to_jsonb(p);
end $fn$;
revoke all on function sgc.odoo_propuesta_decidir(uuid, boolean) from public, anon;
grant execute on function sgc.odoo_propuesta_decidir(uuid, boolean) to authenticated, service_role;
