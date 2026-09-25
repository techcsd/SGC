-- BY4 — Sócrates: "no puedo entrar a revisar todas las bitácoras de los proyectos".
-- Su rol (gerente_proyectos) SÍ puede verlas (módulo proyectos) y en la web el arreglo
-- principal es que el alcance arranque en "Todas" (frontend). Aquí se cierra el hueco
-- ARQUITECTÓNICO (regla 14): la política base de `bitacoras` y la de las tablas hijas
-- (actividades/archivos/equipos/daños) deben usar LA MISMA cláusula. Hoy `puede_ver_bitacora`
-- es MÁS ESTRECHA que la base (no incluía `bitacora.ver_todas` ni ser responsable): un
-- usuario con ver_todas o responsable veía la LISTA pero no el detalle de una bitácora.
-- Una sola fuente: `sgc.puede_ver_bitacora_de(proyecto_id)`.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-25-by4-bitacora-visibilidad.sql --env dev  →  --env prod
-- Rollback: restaurar puede_ver_bitacora con su cláusula anterior y la policy base de aw3-aw5.
begin;

-- Fuente única: ¿el usuario ACTUAL (auth.uid()) puede ver las bitácoras de este proyecto?
-- (Se evalúa siempre para auth.uid(); reusa los helpers auth-based existentes.)
create or replace function sgc.puede_ver_bitacora_de(p_proyecto uuid)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos')
      or sgc.submodulo_nivel_explicito('bitacora.ver_todas') is not null
      or sgc.es_responsable_de_proyecto(p_proyecto);
$function$;
grant execute on function sgc.puede_ver_bitacora_de(uuid) to authenticated, service_role;

-- puede_ver_bitacora(bitacora_id): dueño O la fuente única (para las tablas hijas).
create or replace function sgc.puede_ver_bitacora(p_bitacora_id uuid)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select exists (
    select 1 from sgc.bitacoras b
    where b.id = p_bitacora_id
      and (b.usuario_id = auth.uid() or sgc.puede_ver_bitacora_de(b.proyecto_id))
  );
$function$;

-- Política base de bitacoras = dueño O la fuente única (misma cláusula que las hijas).
drop policy if exists "bitacoras: select" on sgc.bitacoras;
create policy "bitacoras: select" on sgc.bitacoras for select to authenticated
  using (usuario_id = auth.uid() or sgc.puede_ver_bitacora_de(proyecto_id));

commit;
