-- ============================================================================
-- Actualización 7 — Y1 (registrar_version con notas estructuradas) + B6 (destacada)
-- ----------------------------------------------------------------------------
-- Y1: registrar_version gana p_titulo + p_cambios (jsonb [{t,d}]) opcionales.
--     NOTA (el código manda): NO se agrega `notas_estructuradas`; la tabla ya
--     tiene `titulo` + `cambios jsonb` y la UI ya los pinta con chips. Se reutilizan.
--     Cada cambio es {t,d} (t=tipo nuevo|mejora|arreglo|seguridad, d=texto), que
--     es el shape real que usan la UI y las entradas ya estructuradas.
-- Retrocompat: se DROPEA la firma de 3 args y se crea una sola (2–5 args) para
--     evitar overload ambiguo; los llamadores viejos (3 args) siguen funcionando.
-- B6 (QA-057): quitar `destacada` de las categorías INACTIVAS (Clavos/Madera/Acero).
-- Todo aditivo/idempotente.
-- ============================================================================

set search_path = sgc, public;

drop function if exists sgc.registrar_version(text, text, text);

create or replace function sgc.registrar_version(
  p_plataforma text,
  p_version    text,
  p_notas      text  default null,
  p_titulo     text  default null,
  p_cambios    jsonb default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not (sgc.is_admin() or coalesce((select auth.role()), '') = 'service_role') then
    raise exception 'No autorizado.';
  end if;
  if p_plataforma not in ('web', 'movil') then
    raise exception 'plataforma inválida: % (usa web|movil)', p_plataforma;
  end if;
  if coalesce(trim(p_version), '') = '' then
    raise exception 'versión requerida';
  end if;

  insert into sgc.app_versiones (plataforma, version, fecha, notas, titulo, cambios)
  values (
    p_plataforma, trim(p_version), current_date,
    nullif(trim(p_notas), ''),
    nullif(trim(p_titulo), ''),
    case when p_cambios is not null and jsonb_typeof(p_cambios) = 'array'
         then p_cambios else '[]'::jsonb end
  )
  -- Idempotente + enriquecedor: solo RELLENA lo vacío, nunca sobrescribe lo que
  -- ya tenga contenido (p.ej. notas editadas por un admin desde la web).
  on conflict (plataforma, version) do update set
    titulo  = coalesce(sgc.app_versiones.titulo, excluded.titulo),
    notas   = coalesce(sgc.app_versiones.notas,  excluded.notas),
    cambios = case when coalesce(jsonb_array_length(sgc.app_versiones.cambios), 0) = 0
                   then excluded.cambios else sgc.app_versiones.cambios end,
    fecha   = coalesce(sgc.app_versiones.fecha, excluded.fecha)
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function sgc.registrar_version(text, text, text, text, jsonb) to authenticated, service_role;

-- ── B6 (QA-057): destacada solo en categorías oficiales ACTIVAS ──────────────
-- Hoy quedó marcada en inactivas (Clavos/Madera/Acero). Se limpia de forma
-- genérica: ninguna categoría inactiva debe estar destacada.
update sgc.categorias_inventario
   set destacada = false
 where destacada = true and activo = false;
