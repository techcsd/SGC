-- sql/2026-10-29-db12-reportes-ia.sql — Ronda DB (PROMPT-124 F6, DB6)
-- Nota 11 de Xaviel: «quiero que una IA lea el reporte y me dé un texto plano que
-- pueda copiar para mis rondas; y si es hotfix, el prompt listo para Claude Code».
-- El resumen se guarda CON el reporte (no se regenera salvo «Volver a leer»):
--   reportes_usuario.ia_resumen = { resumen_ronda, es_hotfix, motivo, prompt_hotfix }
-- Lo escribe la edge `resumir-reporte` (service role) vía el RPC de abajo, y lo
-- leen el drawer de Administración › Reportes y el conector (resumir_reporte_soporte).
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db12-reportes-ia.sql --env dev

alter table sgc.reportes_usuario add column if not exists ia_resumen jsonb;
alter table sgc.reportes_usuario add column if not exists ia_resumen_at timestamptz;

-- Guardar (lo llama la edge con el jwt del usuario; gate admin/tecnología).
create or replace function sgc.reporte_guardar_ia_resumen(p_id uuid, p_resumen jsonb)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'Solo Administración o Tecnología pueden resumir reportes.' using errcode = '42501';
  end if;
  update sgc.reportes_usuario
     set ia_resumen = p_resumen, ia_resumen_at = now(), updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Reporte no encontrado.' using errcode = 'P0002';
  end if;
end $function$;
grant execute on function sgc.reporte_guardar_ia_resumen(uuid, jsonb) to authenticated, service_role;

-- Leer (drawer + conector resumir_reporte_soporte). Devuelve el resumen guardado
-- con lo básico del reporte; si no hay resumen, el llamador lo genera primero.
create or replace function sgc.reporte_ia_resumen(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'Solo Administración o Tecnología pueden ver los resúmenes de reportes.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', r.id, 'asunto', r.asunto, 'tipo', r.tipo, 'estado', r.estado,
    'autor', (select u.nombre from sgc.usuarios u where u.id = r.usuario_id),
    'ia_resumen', r.ia_resumen, 'ia_resumen_at', r.ia_resumen_at)
  into v from sgc.reportes_usuario r where r.id = p_id;
  if v is null then
    raise exception 'Reporte no encontrado.' using errcode = 'P0002';
  end if;
  return v;
end $function$;
grant execute on function sgc.reporte_ia_resumen(uuid) to authenticated, service_role;
