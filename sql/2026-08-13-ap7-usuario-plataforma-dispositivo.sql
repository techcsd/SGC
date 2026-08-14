-- =============================================================================
-- PROMPT-11 FASE 5 (AP7) — Tipo de dispositivo del conductor: automático.
-- SGC padre. La app (csd-app, PROMPT-12) reporta la plataforma al iniciar sesión
-- / sincronizar (Capacitor Device API). Aquí el contrato de captura + exposición.
--
-- Se guarda en `sgc.usuarios` (nivel sesión/cuenta) porque cualquier usuario de la
-- app la reporta; Conductores la muestra vía el vínculo conductor→usuario. Aditivo.
-- Reemplaza cualquier "tipo de dispositivo" manual (no existía ninguno hoy).
-- =============================================================================

begin;

alter table sgc.usuarios
  add column if not exists plataforma        text,        -- android | ios | ios-pwa | web
  add column if not exists plataforma_modelo text,        -- ej. "iPhone 13", "SM-G991B"
  add column if not exists plataforma_at      timestamptz; -- último reporte

comment on column sgc.usuarios.plataforma is
  'AP7 — plataforma del dispositivo reportada automáticamente por la app (android|ios|ios-pwa|web). No editable a mano.';

-- La app reporta su propia plataforma (SECURITY DEFINER: actualiza sólo su fila).
create or replace function sgc.set_mi_plataforma(p_plataforma text, p_modelo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if p_plataforma is null or p_plataforma not in ('android','ios','ios-pwa','web') then
    raise exception 'Plataforma inválida: %', p_plataforma;
  end if;
  update sgc.usuarios
     set plataforma = p_plataforma,
         plataforma_modelo = nullif(trim(coalesce(p_modelo, '')), ''),
         plataforma_at = now()
   where id = v_uid;
end;
$$;
grant execute on function sgc.set_mi_plataforma(text, text) to authenticated;
comment on function sgc.set_mi_plataforma(text, text) is
  'AP7 — la app reporta la plataforma del dispositivo del usuario autenticado (android|ios|ios-pwa|web + modelo). Actualiza sólo su propia fila de usuarios.';

commit;
