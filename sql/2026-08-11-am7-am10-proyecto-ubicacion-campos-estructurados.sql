-- =============================================================================
-- PROMPT-5 FASE 4+5 (AM7, AM8, AM10) — Ronda 11/08/2026 (IDs AM). SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- Contexto: sgc.proyectos YA tiene latitud numeric(9,6), longitud numeric(9,6),
--   direccion_geo text (context-system) y el picker Leaflet ya está cableado en
--   crear/editar. Lo que falta:
--   · AM7 — pegar link de Google Maps / coordenadas (además del pin). El resolver
--     de short links vive en la edge function `resolve-maps-link` (el cliente no
--     puede seguir el redirect por CORS). Aquí: RPC canónica para fijar/validar la
--     ubicación (rango válido) que usan web y app por igual.
--   · AM8 — lista de obras sin ubicación estructurada (indicador para admin) +
--     soporte del backfill (el lote se aplica aparte, con revisión de Xaviel).
--   · AM10 — data que hoy vive embutida en `descripcion` promovida a campos:
--     ingeniero de obra, contacto (nombre/teléfono), maestro encargado.
-- =============================================================================

begin;

-- ── 1) AM10 — campos estructurados del proyecto (informativos de obra) ────────
alter table sgc.proyectos
  add column if not exists ingeniero_obra      text,
  add column if not exists maestro_encargado   text,
  add column if not exists contacto_nombre     text,
  add column if not exists contacto_telefono   text,
  add column if not exists ubicacion_metodo    text;   -- maps_link|coords|pin|backfill

comment on column sgc.proyectos.ingeniero_obra    is 'AM10 — ingeniero(s)/arq. de obra (texto libre; el vínculo a usuarios sigue en proyecto_responsables).';
comment on column sgc.proyectos.maestro_encargado is 'AM10 — maestro(s) encargado(s) de la obra.';
comment on column sgc.proyectos.contacto_nombre   is 'AM10 — nombre del contacto de obra (opcional).';
comment on column sgc.proyectos.contacto_telefono is 'AM10 — teléfono(s) de contacto de obra (clicable tel: en la UI).';
comment on column sgc.proyectos.ubicacion_metodo  is 'AM7 — cómo se fijó la ubicación: maps_link | coords | pin | backfill.';

-- ── 2) AM7 — RPC canónica para fijar la ubicación (valida rango) ─────────────
-- Web y app la usan por igual tras resolver el link (edge) / pegar coords / pin.
create or replace function sgc.set_proyecto_ubicacion(
  p_proyecto_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_direccion text default null,
  p_metodo    text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No autorizado para editar la ubicación del proyecto.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Faltan las coordenadas de la ubicación.' using errcode = 'DR471';
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Coordenadas fuera de rango (lat %, lng %).', p_lat, p_lng using errcode = 'DR472';
  end if;
  update sgc.proyectos
     set latitud = round(p_lat::numeric, 6),
         longitud = round(p_lng::numeric, 6),
         direccion_geo = coalesce(nullif(trim(p_direccion),''), direccion_geo),
         ubicacion_metodo = coalesce(nullif(trim(p_metodo),''), ubicacion_metodo),
         updated_at = now()
   where id = p_proyecto_id;
  if not found then raise exception 'Proyecto no encontrado.'; end if;
end;
$$;
grant execute on function sgc.set_proyecto_ubicacion(uuid, numeric, numeric, text, text) to authenticated, service_role;
comment on function sgc.set_proyecto_ubicacion(uuid, numeric, numeric, text, text) is
  'AM7 — fija/valida la ubicación estructurada de un proyecto (rango válido, redondeo 6 dec). La usan web y app tras resolver link Maps / pegar coords / pin.';

-- ── 3) AM8 — obras (activas) sin ubicación estructurada, para el aviso admin ──
-- Marca además si la descripción trae un link de Maps (candidato a backfill).
create or replace function sgc.proyectos_sin_ubicacion()
returns table (
  id uuid, codigo text, nombre text, estado text,
  tiene_link_en_texto boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p.id, p.codigo, p.nombre, p.estado,
         (coalesce(p.descripcion,'')||' '||coalesce(p.direccion_geo,'')||' '||coalesce(p.ubicacion,''))
           ~* 'maps\.app\.goo\.gl|goo\.gl/maps|google\.[a-z.]+/maps|-?[0-9]{1,3}\.[0-9]{3,}\s*,\s*-?[0-9]{1,3}\.[0-9]{3,}'
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (p.latitud is null or p.longitud is null)
    and ((not coalesce(p.es_prueba,false)) or sgc.is_admin())
  order by p.codigo;
$$;
grant execute on function sgc.proyectos_sin_ubicacion() to authenticated, service_role;
comment on function sgc.proyectos_sin_ubicacion() is
  'AM8 — proyectos activos sin ubicación estructurada (lat/lng). tiene_link_en_texto marca candidatos a backfill desde la descripción.';

commit;
