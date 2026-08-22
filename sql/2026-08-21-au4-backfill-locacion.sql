-- AU4 — Backfill de la locación estructurada de los proyectos existentes, a partir
-- del texto libre `ubicacion`/`zona`. ⚠️ PRESENTAR A XAVIEL ANTES DE APLICAR (AM8).
-- No borra el texto libre; solo rellena provincia_id/municipio_id/sector_id cuando el
-- mapeo es claro. Los ambiguos o vacíos se dejan en null (se completan a mano).
--
-- Mapeo propuesto (13 proyectos, datos al 21/08/2026):
--   Cap Cana (3), Cana Bay (2), Vista Cana (1), Punta Cana (1)
--        → La Altagracia / Higüey / <ese sector>
--   Santo Dominfo DN Piantini (1)  → Distrito Nacional / Distrito Nacional / Piantini
--   Distrito Nacional (1), Santo Domingo (1) → Distrito Nacional / Distrito Nacional / (sin sector)
--   San Pedro de Macorís (1) → San Pedro de Macorís / San Pedro de Macorís / (sin sector)
--   (vacío) (3) y "TEST Ubicación Proyecto" (1) → se dejan en null

-- Helper local: fija la cascada por nombres de sector de Higüey (La Altagracia).
update sgc.proyectos p
   set provincia_id = pr.id, municipio_id = mu.id, sector_id = se.id
  from sgc.sectores se
  join sgc.municipios mu on mu.id = se.municipio_id
  join sgc.provincias pr on pr.id = mu.provincia_id
 where pr.nombre = 'La Altagracia' and mu.nombre = 'Higüey'
   and se.nombre = trim(p.ubicacion)
   and p.provincia_id is null;

-- Piantini (DN)
update sgc.proyectos p
   set provincia_id = pr.id, municipio_id = mu.id, sector_id = se.id
  from sgc.sectores se
  join sgc.municipios mu on mu.id = se.municipio_id
  join sgc.provincias pr on pr.id = mu.provincia_id
 where pr.nombre = 'Distrito Nacional' and mu.nombre = 'Distrito Nacional' and se.nombre = 'Piantini'
   and p.ubicacion ilike '%piantini%' and p.provincia_id is null;

-- Distrito Nacional / Santo Domingo (sin sector concreto)
update sgc.proyectos p
   set provincia_id = pr.id, municipio_id = mu.id
  from sgc.municipios mu join sgc.provincias pr on pr.id = mu.provincia_id
 where pr.nombre = 'Distrito Nacional' and mu.nombre = 'Distrito Nacional'
   and (trim(p.ubicacion) in ('Distrito Nacional', 'Santo Domingo'))
   and p.provincia_id is null;

-- San Pedro de Macorís
update sgc.proyectos p
   set provincia_id = pr.id, municipio_id = mu.id
  from sgc.municipios mu join sgc.provincias pr on pr.id = mu.provincia_id
 where pr.nombre = 'San Pedro de Macorís' and mu.nombre = 'San Pedro de Macorís'
   and trim(p.ubicacion) = 'San Pedro de Macorís'
   and p.provincia_id is null;
