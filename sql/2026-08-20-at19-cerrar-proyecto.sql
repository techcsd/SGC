-- ============================================================================
-- AT19 — Cerrar una obra terminada (Brisas City Center). Reversible por admin.
-- Cerrar = estado 'terminada' + activo=false → sale de los selectores (que filtran
-- por activo, p.ej. directorio_proyectos) y deja de contar como obra activa / de
-- generar alertas de clima, PERO su historial (conduces, requisiciones, personal,
-- inventario) queda consultable (esos registros referencian proyecto_id y sus
-- joins no dependen de activo). Se conserva traza de quién/cuándo.
-- Decisión Xaviel (AT19): se deja el inventario como está (sin devolución forzada).
-- ============================================================================
set search_path = sgc, public;

alter table sgc.proyectos add column if not exists cerrado_at  timestamptz;
alter table sgc.proyectos add column if not exists cerrado_por uuid references sgc.usuarios(id);

create or replace function sgc.cerrar_proyecto(p_id uuid, p_cerrar boolean default true)
returns void
language plpgsql security definer set search_path = sgc, public as $$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede cerrar o reabrir una obra' using errcode = '42501';
  end if;
  if p_cerrar then
    update sgc.proyectos
       set estado = 'terminada', activo = false, cerrado_at = now(), cerrado_por = auth.uid()
     where id = p_id;
  else
    update sgc.proyectos
       set estado = 'en_progreso', activo = true, cerrado_at = null, cerrado_por = null
     where id = p_id;
  end if;
end;
$$;
grant execute on function sgc.cerrar_proyecto(uuid, boolean) to authenticated, service_role;
