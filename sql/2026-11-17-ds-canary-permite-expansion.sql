-- 2026-11-17 -- DS-28: con la fase EXPANSION encendida, odoo_canary_permite debe permitir todo (antes solo miraba el canary y
-- seguia restringiendo al piloto aunque la expansion estuviera encendida). Aditiva: solo agrega el atajo de expansion.
create or replace function sgc.odoo_canary_permite(p_salida uuid)
returns boolean language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_f sgc.odoo_fases%rowtype; v_s sgc.salidas_inventario%rowtype; v_org text; v_dst text;
begin
  if not (auth.role() = 'service_role' or sgc.es_tecnologia()) then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;
  select * into v_f from sgc.odoo_fases where clave = 'canary';
  if not coalesce(v_f.habilitada, false) then return true; end if;
  if coalesce((select habilitada from sgc.odoo_fases where clave = 'expansion'), false) then return true; end if;
  select * into v_s from sgc.salidas_inventario where id = p_salida;
  if not found then return false; end if;
  select codigo_odoo into v_org from sgc.bodegas where id = v_s.bodega_id;
  select codigo_odoo into v_dst from sgc.bodegas where id = v_s.destino_almacen_id;
  if v_org is distinct from (v_f.config #>> '{par,origen}') or v_dst is distinct from (v_f.config #>> '{par,destino}') then return false; end if;
  if not (coalesce(v_s.creado_por::text, '') in (select jsonb_array_elements_text(coalesce(v_f.config -> 'usuarios_piloto', '[]'::jsonb)))) then return false; end if;
  return not exists (
    select 1 from sgc.detalle_salidas d
     where d.salida_id = p_salida
       and not (d.articulo_id::text in (select jsonb_array_elements_text(coalesce(v_f.config -> 'articulos_piloto', '[]'::jsonb)))));
end $fn$;
