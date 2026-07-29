-- ============================================================================
-- Z6.4b — Artículos: ámbito de uso (obra | oficina | ambos)
-- ----------------------------------------------------------------------------
-- Contexto: en "Nueva Orden de Compra" el destino puede ser `proyecto` (obra) u
-- `oficina` (sgc.ordenes_compra.destino, ya existe). Hoy el selector de ítems
-- (app-articulo-picker) muestra el MISMO catálogo sin importar el destino.
--
-- En `articulos` NO existe ningún campo que distinga "material de obra" de
-- "suministro de oficina":
--   · `propiedad` (propio_csd | alquilado) describe la PROPIEDAD/tenencia, no el
--     USO — reutilizarla sería semánticamente incorrecto.
--   · Las categorías "Oficina" / "Cocina y Baño" existen (seed kit de obra) pero
--     clasificar por nombre de categoría es frágil y arbitrario.
--
-- Solución mínima y aditiva: una columna `ambito` de tres estados.
--   · 'ambos'   (DEFAULT) → el artículo aparece en AMBOS destinos. Al no backfillear
--                nada queda 100 % retrocompatible: hoy todo es dual-uso, el filtro
--                no oculta nada hasta que un admin cure el catálogo.
--   · 'obra'    → solo aparece cuando el destino de la OC es Proyecto/Obra.
--   · 'oficina' → solo aparece cuando el destino de la OC es Oficina.
--
-- El filtro del picker queda cableado a este campo (ver ordenes.ts):
--   destino=oficina  → ambito in ('oficina','ambos')
--   destino=proyecto → ambito in ('obra','ambos')
--
-- La columna viaja a la web y a la app vía `select *` sobre articulos (RLS
-- existente); no hace falta tocar servicios ni contratos.
-- Aditivo, idempotente. NO aplicada aún — pendiente de aplicar en prod.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.articulos
  add column if not exists ambito text not null default 'ambos';

do $$ begin
  alter table sgc.articulos add constraint articulos_ambito_chk
    check (ambito in ('obra','oficina','ambos'));
exception when duplicate_object then null; end $$;

comment on column sgc.articulos.ambito is
  'Z6.4b — obra | oficina | ambos (default). Filtra el catálogo de la OC según su destino (proyecto/obra vs oficina). Curado por admin; ''ambos'' = dual-uso.';

-- ----------------------------------------------------------------------------
-- Backfill OPCIONAL (comentado a propósito — NO clasificar automáticamente para
-- no inventar lógica arbitraria). El default 'ambos' ya deja todo funcional y
-- retrocompatible. Descomenta si quieres que los suministros de las categorías
-- explícitamente de oficina dejen de aparecer en las OC de obra:
--
-- update sgc.articulos a
--    set ambito = 'oficina', updated_at = now()
--   from sgc.categorias_inventario c
--  where a.categoria_id = c.id
--    and c.nombre in ('Oficina', 'Cocina y Baño')
--    and a.ambito = 'ambos';
-- ----------------------------------------------------------------------------
