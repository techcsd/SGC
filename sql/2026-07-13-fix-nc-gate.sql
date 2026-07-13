-- Fix: la "regla de oro" no bloqueaba vaciados de un elemento cuando la NC era
-- de alcance PROYECTO (elemento_id null). `null is not distinct from <uuid>` = false,
-- así que una NC abierta a nivel de obra no impedía liberar/vaciar un elemento.
-- Correcto: una NC de proyecto (elemento_id null) bloquea TODOS los vaciados del
-- proyecto; una NC de elemento bloquea los vaciados de ese elemento.
create or replace function sgc.trg_nc_bloquea_vaciado() returns trigger language plpgsql
set search_path to 'sgc','pg_temp' as $$
begin
  if NEW.estado in ('liberado','vaciado') and (OLD.estado is distinct from NEW.estado) then
    if exists (select 1 from sgc.obra_no_conformidades nc
      where nc.estado='abierta' and nc.bloquea_vaciado
        and (nc.vaciado_id = NEW.id
             or (nc.vaciado_id is null
                 and nc.proyecto_id = NEW.proyecto_id
                 and (nc.elemento_id is null or nc.elemento_id = NEW.elemento_id)))) then
      raise exception 'No se puede % el vaciado: hay una No Conformidad abierta que lo bloquea.', NEW.estado;
    end if;
    if not exists (select 1 from sgc.cl_registros r where r.vaciado_id = NEW.id and r.estado='firmado') then
      raise exception 'No se puede % el vaciado: falta el checklist de liberación (CL) firmado.', NEW.estado;
    end if;
  end if;
  return NEW;
end; $$;
