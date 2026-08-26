-- ============================================================================
-- PROMPT-16 (AZ) — Ronda 19-27/08/2026.
-- AZ6: "Otros" en el SEGUNDO nivel de la bitácora (actividades de "¿Qué se hizo?").
--
-- La UI (app + web) ya deja escribir una actividad "Otros" (texto libre) igual
-- que el primer nivel (estructura, AX6). Falta que esos textos libres ALIMENTEN
-- el repositorio "Valores 'Otro'" de Administración (sgc.otros_valores) para
-- promoverlos a actividades oficiales — el mismo ciclo que ya existe para
-- restricciones ('bitacora.restriccion'), sucesos y equipos.
--
-- Se hace por TRIGGER de BD (igual que trg_registrar_otro_restriccion), NO
-- tocando los RPCs crear_bitacora_app / crear_entrada_bitacora: así cubre web y
-- móvil a la vez, sin recrear funciones grandes y sin riesgo de drift. Registra
-- una estructura o actividad SOLO cuando NO existe en el catálogo oficial
-- (bitacora_catalogos) — misma prueba de membresía que usa el bloque de suceso.
--
-- Contextos nuevos (se pintan solos en /admin/otros-valores vía contextoLabel):
--   'bitacora.actividad'  → "bitacora · actividad"
--   'bitacora.estructura' → "bitacora · estructura"
--
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scripts/apply-migration.mjs sql/2026-08-26-az6-bitacora-otros-actividad.sql
-- ============================================================================
set search_path = sgc, public;

-- Registro automático de "Otros" en actividades/estructuras de bitácora.
-- SECURITY DEFINER: corre con privilegios del dueño; auth.uid() (dentro de
-- registrar_otro_valor) sigue siendo el usuario del JWT. Best-effort: cualquier
-- fallo de registro NO debe tumbar el insert de la actividad.
create or replace function sgc.trg_registrar_otro_actividad()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  -- Actividad libre (segundo nivel, AZ6): registra si no está en el catálogo.
  if coalesce(trim(new.actividad),'') <> ''
     and not exists (
       select 1 from sgc.bitacora_catalogos c
       where c.tipo = 'actividad' and upper(c.valor) = upper(trim(new.actividad))
     ) then
    begin perform sgc.registrar_otro_valor('bitacora.actividad', trim(new.actividad), new.bitacora_id);
    exception when others then null; end;
  end if;

  -- Estructura libre (primer nivel, AX6 "Otros"): mismo ciclo, para promoverla.
  if coalesce(trim(new.estructura),'') <> ''
     and not exists (
       select 1 from sgc.bitacora_catalogos c
       where c.tipo = 'estructura' and upper(c.valor) = upper(trim(new.estructura))
     ) then
    begin perform sgc.registrar_otro_valor('bitacora.estructura', trim(new.estructura), new.bitacora_id);
    exception when others then null; end;
  end if;

  return new;
end $$;

drop trigger if exists trg_otro_actividad on sgc.bitacora_actividades;
create trigger trg_otro_actividad
  after insert on sgc.bitacora_actividades
  for each row execute function sgc.trg_registrar_otro_actividad();
