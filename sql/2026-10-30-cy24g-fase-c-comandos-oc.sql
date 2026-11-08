-- CY24 Fase C [feature #24] -- primera pieza de "escribir la OC de verdad en
-- Odoo": idempotencia de comandos (D3) + RPC de validacion/ensamblado que el
-- edge llama ANTES de tocar Odoo (D5 -- "el edge nunca confia en el
-- cliente", relee todo con service role).
--
-- D7 (no se toca crear_orden_compra) sigue vigente: esto es codigo NUEVO que
-- se dispara DESPUES de que la OC ya existe en SGC, nunca durante su
-- creacion.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

-- D3 -- "cada comando (crear, confirmar, cancelar) se registra con clave
-- estable instancia + OC uuid + accion + revision". Ejecucion SINCRONA (el
-- edge llama a Odoo en el mismo request), a diferencia del outbox async de
-- CY6 -- por eso es una tabla propia, no se reusa sgc.odoo_eventos (esa es
-- para eventos asincronos reclamados por un procesador).
create table sgc.odoo_comandos_oc (
  id uuid primary key default gen_random_uuid(),
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  orden_id uuid not null references sgc.ordenes_compra(id),
  accion text not null check (accion in ('crear', 'confirmar', 'cancelar')),
  revision integer not null default 1 check (revision > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'completado', 'error', 'incierto')),
  resultado jsonb,
  error text,
  es_prueba boolean not null default false,
  creado_por uuid references auth.users(id),
  creado_en timestamptz not null default now(),
  finalizado_en timestamptz,

  -- Idempotencia real: reintentar el MISMO comando/revision de la MISMA OC
  -- devuelve el resultado ya registrado, nunca repite la llamada a Odoo.
  constraint odoo_comandos_oc_clave_unica unique (odoo_instancia_id, orden_id, accion, revision)
);
comment on table sgc.odoo_comandos_oc is 'CY24 Fase C -- idempotencia + auditoria de comandos sincronos hacia Odoo (crear/confirmar/cancelar OC). D-16: es_prueba nunca se publica, aunque quede registrado el intento.';
create index odoo_comandos_oc_por_orden on sgc.odoo_comandos_oc (orden_id, accion, revision desc);
alter table sgc.odoo_comandos_oc enable row level security;

create policy odoo_comandos_oc_select on sgc.odoo_comandos_oc
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));

grant select on sgc.odoo_comandos_oc to authenticated;
grant select, insert, update on sgc.odoo_comandos_oc to service_role;

-- RPC: valida (E9, E10, criterio 6) y ensambla lo necesario para publicar.
-- SECURITY DEFINER -- el edge la llama con service role, releyendo la OC
-- directo de la BD (D5), nunca confiando en lo que mande el navegador.
create or replace function sgc.oc_para_publicar(p_orden_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_oc sgc.ordenes_compra;
  v_proveedor sgc.proveedores;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_lineas jsonb;
  v_lineas_sin_producto integer;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede publicar una orden de compra en Odoo' using errcode = '42501';
  end if;

  select * into v_oc from sgc.ordenes_compra where id = p_orden_id;
  if not found then raise exception 'Orden de compra no encontrada'; end if;

  -- D-16 / E10: una OC de prueba NUNCA se publica, aunque se pida.
  if coalesce(v_oc.es_prueba, false) then
    raise exception 'Una orden de compra de prueba no se publica en Odoo' using errcode = '22023';
  end if;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    raise exception 'No hay una instancia de Odoo habilitada para publicar' using errcode = '22023';
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  select * into v_proveedor from sgc.proveedores where id = v_oc.proveedor_id;
  -- E9: proveedor sin vinculo a Odoo bloquea la publicacion con mensaje claro.
  if v_proveedor.odoo_id is null then
    raise exception 'El proveedor de esta orden todavía no está vinculado a Odoo (%)', v_proveedor.nombre using errcode = '22023';
  end if;

  -- Criterio 6: una línea sin producto Odoo no se puede publicar; se indica cuáles faltan.
  select count(*) into v_lineas_sin_producto
    from sgc.orden_compra_items where orden_id = p_orden_id and odoo_product_id is null;
  if v_lineas_sin_producto > 0 then
    raise exception '% línea(s) de esta orden todavía no tienen producto de Odoo vinculado' , v_lineas_sin_producto using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', oci.id, 'odoo_product_id', oci.odoo_product_id, 'odoo_uom_id', oci.odoo_uom_id,
      'cantidad', oci.cantidad, 'precio_unitario', oci.precio_unitario, 'descripcion', oci.descripcion
    )), '[]'::jsonb)
    into v_lineas
    from sgc.orden_compra_items oci where oci.orden_id = p_orden_id;

  return jsonb_build_object(
    'odoo_instancia_id', v_instancia_id,
    'orden_id', v_oc.id,
    'numero', v_oc.numero,
    'odoo_proveedor_id', v_proveedor.odoo_id,
    'fecha', v_oc.fecha,
    'fecha_entrega_esperada', v_oc.fecha_entrega_esperada,
    'notas', v_oc.notas,
    'lineas', v_lineas,
    'odoo_sync_estado_actual', v_oc.odoo_sync_estado,
    'odoo_id_existente', v_oc.odoo_id
  );
end;
$fn$;
comment on function sgc.oc_para_publicar is 'SGC Odoo foundation v1 (CY24 Fase C) -- valida (D-16/E9/E10/criterio 6) y ensambla la OC para publicar; el edge nunca confía en lo que mande el navegador (D5).';
revoke all on function sgc.oc_para_publicar(uuid) from public, anon;
grant execute on function sgc.oc_para_publicar(uuid) to authenticated, service_role;

commit;
