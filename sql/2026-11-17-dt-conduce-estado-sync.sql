-- 2026-11-17 -- pedido de la app (ODOO-INTEGRACION-AVANCE-APP): estado contable de un conduce para el chip de gestion.
-- salidas_inventario no tiene odoo_sync_estado; se deriva de los eventos del outbox. Solo flota-elevado o tecnologia; los demas reciben null.
-- Valores: sincronizado | pendiente | incierto | error | null (nunca se intento / sin permiso).
create or replace function sgc.conduce_estado_sync(p_salida_id uuid)
returns text
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_n int; v_err int; v_inc int; v_pen int;
begin
  if not (sgc.es_flota_elevado() or sgc.es_tecnologia()) then return null; end if;
  select count(*),
         count(*) filter (where estado in ('error','bloqueado')),
         count(*) filter (where estado = 'incierto'),
         count(*) filter (where estado in ('pendiente','procesando','reintento'))
    into v_n, v_err, v_inc, v_pen
    from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and agregado_id = p_salida_id::text;
  if v_n = 0 then return null; end if;
  if v_err > 0 then return 'error'; end if;
  if v_inc > 0 then return 'incierto'; end if;
  if v_pen > 0 then return 'pendiente'; end if;
  return 'sincronizado';
end $$;
revoke all on function sgc.conduce_estado_sync(uuid) from public;
grant execute on function sgc.conduce_estado_sync(uuid) to authenticated;
