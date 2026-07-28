-- ============================================================================
-- Y11b — Rol tecnología puede MARCAR una versión de la app como publicada/mínima
-- Ronda 28/07/2026 · ajuste post-PROMPT-1
-- ============================================================================
-- Decisión de Xaviel: el rol `tecnologia` NO publica/crea versiones (eso será de
-- un futuro rol "Desarrollador de software"), pero SÍ puede marcar una versión
-- existente como publicada y/o mínima. Crear/editar/eliminar sigue admin-only.
--
-- RPCs SECURITY DEFINER que tocan SOLO las banderas publicada/minima, gateadas a
-- es_tecnologia() (admin | tecnologia). La política UPDATE directa de
-- app_versiones sigue en is_admin() (ediciones completas = admin).
-- ============================================================================

create or replace function sgc.marcar_version_publicada(p_id uuid, p_publicada boolean)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update sgc.app_versiones
     set publicada = p_publicada,
         publicada_at = case when p_publicada then now() else publicada_at end,
         publicada_por = case when p_publicada then auth.uid() else publicada_por end
   where id = p_id;
end;
$$;
grant execute on function sgc.marcar_version_publicada(uuid, boolean) to authenticated, service_role;

create or replace function sgc.marcar_version_minima(p_id uuid, p_minima boolean)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update sgc.app_versiones set minima = p_minima where id = p_id;
end;
$$;
grant execute on function sgc.marcar_version_minima(uuid, boolean) to authenticated, service_role;

comment on function sgc.marcar_version_publicada is 'Y11b — marca una versión app como publicada/despublicada. admin|tecnologia.';
comment on function sgc.marcar_version_minima is 'Y11b — marca una versión app como mínima/no-mínima. admin|tecnologia.';
