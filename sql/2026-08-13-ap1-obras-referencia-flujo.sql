-- =============================================================================
-- PROMPT-11 FASE 1 (AP1) — Ronda 13/08/2026. SGC padre.
--
-- 🔴 SÍNTOMA: chofer creando conduce → "Obra destino" → "No hay opciones."
--
-- DIAGNÓSTICO (causa raíz):
--   El flujo de conduce lee la TABLA `sgc.proyectos` directamente (web:
--   ProyectosService.getAll(); app: query directa). Esa lectura depende de la
--   policy RLS `proyectos: select`, que compuerta por MÓDULO. Esa policy ha
--   REGRESADO varias veces (AH2 la abrió a flota/transporte, AM4/AN3 la
--   re-tocaron) — es frágil por diseño: cualquier retoque de permisos de
--   Proyectos puede volver a dejar al chofer sin obras. Además getAll() arrastra
--   embeds sensibles (responsable/responsables → usuarios).
--
--   Estado actual en prod: la policy HOY incluye flota/transporte y el rol Chofer
--   (id 19: flota+transporte) SÍ lee las 11 obras reales. Pero la fragilidad
--   arquitectónica permanece: el flujo NO debe depender de la RLS del módulo.
--
-- FIX (misma regla de referencia por flujo, AN3):
--   El wizard debe leer las obras por el DIRECTORIO SECURITY DEFINER
--   `sgc.directorio_proyectos()` — desacoplado del módulo Proyectos, expone sólo
--   lo operativo (id/código/nombre/estado/ubicación/activo) SIN financieros.
--   Aquí lo ampliamos (aditivo) con latitud/longitud para que el destino del
--   conduce/ruta pueda fijar coordenadas sin abrir la tabla. La web (salidas.ts)
--   y la app (PROMPT-12) consumen este contrato — nunca más la tabla cruda.
--
-- Matriz del wizard × referencia × rol chofer (verificada en prod, impersonando
-- POLIN RAMIREZ 923db39f…): almacenes(bodegas)=20 ✔, obras(directorio)=11 ✔,
-- ferreterías(ferreterias_visibles)=1 ✔, despachantes(despachantes_disponibles)=14 ✔,
-- materiales(articulos)+existencias(stock_por_bodega)=36 ✔, receptores=texto libre.
-- =============================================================================

begin;

-- Return-type cambia (agrega lat/lng) → drop + recreate. Sin dependientes en BD
-- (sólo la consumen clientes vía RPC).
drop function if exists sgc.directorio_proyectos();

create function sgc.directorio_proyectos()
returns table (
  id uuid, codigo text, nombre text, estado text, ubicacion text,
  activo boolean, latitud numeric, longitud numeric
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p.id, p.codigo, p.nombre, p.estado, p.ubicacion, p.activo,
         p.latitud, p.longitud
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (not coalesce(p.es_prueba, false) or sgc.is_admin())
  order by p.nombre;
$$;
grant execute on function sgc.directorio_proyectos() to authenticated;
comment on function sgc.directorio_proyectos() is
  'AN3/AP1 — directorio de referencia de obras (id, codigo, nombre, estado, ubicacion, activo, latitud, longitud) para flujos que referencian obras (conduce/ruta destino) SIN el módulo Proyectos. SECURITY DEFINER, sin financieros. Contrato único web+app para el selector de obra destino.';

commit;
