-- ============================================================================
-- AD8 — Ronda 31/07/2026 (PROMPT-15 FASE 4)
-- Carga de los 10 proyectos EN CURSO (PDF proyectos-en-curso-csd.pdf, 09-ene-2026).
-- Datos REALES (es_prueba=false). Idempotente: matching por nombre, no duplica.
-- - "GV CONSTRUCCION - Torre Alpha" hace match con el proyecto existente
--   "Torre Alpha" (se enriquece, no se duplica).
-- - Ingenieros vinculados a usuarios existentes cuando coinciden (hoy solo
--   Manuel Guilamo y Jonathan Roman existen como usuarios) vía proyecto_responsables.
-- - Contactos y maestros encargados se guardan en `descripcion` (no hay campo
--   dedicado; opción "notas del proyecto" del prompt) + el link de Maps en
--   `direccion_geo` y `ubicacion` legible.
-- ============================================================================

-- 1) Enriquecer el proyecto existente "Torre Alpha" (= GV CONSTRUCCION - Torre Alpha).
update sgc.proyectos p set
  cliente = coalesce(p.cliente, 'GV CONSTRUCCION'),
  responsable_nombre = coalesce(p.responsable_nombre, 'Ing. Manuel Guilamo'),
  direccion_geo = coalesce(p.direccion_geo, 'https://maps.app.goo.gl/tYAPsaAcZXgfBE6r6'),
  descripcion = coalesce(nullif(p.descripcion,''),
    E'Ubicación (Maps): https://maps.app.goo.gl/tYAPsaAcZXgfBE6r6\n'
    'Ing. de obra: Ing. Manuel Guilamo / Jonathan Roman\n'
    'Contacto: +1 809 315 0123 / +1 829 966 3040\n'
    'Maestro(s) encargado(s): Jose Nuñez / Elidos'),
  es_prueba = false,
  updated_at = now()
where lower(p.nombre) = 'torre alpha';

-- 2) Insertar los 9 proyectos que faltan (guardado por nombre, idempotente).
insert into sgc.proyectos (codigo, nombre, cliente, estado, ubicacion, direccion_geo, responsable_nombre, descripcion, activo, es_prueba)
select v.codigo, v.nombre, v.cliente, 'en_progreso', v.ubicacion, v.maps, v.ing1, v.descripcion, true, false
from (values
  ('CSD-101', 'ASA - Residencial Romo (Cap Cana)', 'ASA', 'Cap Cana',
   'https://maps.app.goo.gl/XsmdNv1JmVQLqJKCA', 'Arq. Bernabel Ortiz',
   E'Ubicación (Maps): https://maps.app.goo.gl/XsmdNv1JmVQLqJKCA\nIng. de obra: Arq. Bernabel Ortiz\nContacto: +1 809 271 9751\nMaestro(s) encargado(s): Victor Bautista (Yolanda)'),
  ('CSD-102', 'BATCON - Interplaza (San Pedro de Macorís)', 'BATCON', 'San Pedro de Macorís',
   'https://maps.app.goo.gl/HjFt7pYZ3BFkKSms5', 'Ing. Ivan Lapaix',
   E'Ubicación (Maps): https://maps.app.goo.gl/HjFt7pYZ3BFkKSms5\nIng. de obra: Ing. Ivan Lapaix\nContacto: +1 829 855 5651\nMaestro(s) encargado(s): Prin Roy / Franklin'),
  ('CSD-103', 'BEST IN PRO - City Place (Punta Cana)', 'BEST IN PRO', 'Punta Cana',
   'https://maps.app.goo.gl/bfwhgz5QUhE8eSPm9', 'Ing. Abraham Mercedez',
   E'Ubicación (Maps): https://maps.app.goo.gl/bfwhgz5QUhE8eSPm9\nIng. de obra: Ing. Abraham Mercedez\nContacto: +1 829 958 1269\nMaestro(s) encargado(s): Antonio Urbaez'),
  ('CSD-104', 'BLUEWAVE - Olea (Cap Cana)', 'BLUEWAVE', 'Cap Cana',
   'https://maps.app.goo.gl/64weY9ydXBYUVAJY6', 'Arq. Bernabel Ortiz',
   E'Ubicación (Maps): https://maps.app.goo.gl/64weY9ydXBYUVAJY6\nIng. de obra: Arq. Bernabel Ortiz\nContacto: +1 809 298 1731\nMaestro(s) encargado(s): Antonio Urbaez'),
  ('CSD-105', 'BLUEWAVE - Volares (Cap Cana)', 'BLUEWAVE', 'Cap Cana',
   'https://maps.app.goo.gl/XZdgudmYZCu3KW59A', 'Arq. Bernabel Ortiz',
   E'Ubicación (Maps): https://maps.app.goo.gl/XZdgudmYZCu3KW59A\nIng. de obra: Arq. Bernabel Ortiz\nContacto: +1 809 271 9751\nMaestro(s) encargado(s): Franklin'),
  ('CSD-106', 'NOVAL - Poseidonia (Cana Bay)', 'NOVAL', 'Cana Bay',
   'https://maps.app.goo.gl/vCLek3cratVqdacW7', 'Ing. Juan Ramon Oscena',
   E'Ubicación (Maps): https://maps.app.goo.gl/vCLek3cratVqdacW7\nIng. de obra: Ing. Juan Ramon Oscena / Ing. Esperanza Diaz\nContacto: +1 809 351 8690 / +1 829 901 3559\nMaestro(s) encargado(s): Victor Bautista (Yolanda) / Edito Vargas'),
  ('CSD-107', 'NOVAL - Riviera Bay (Cana Bay)', 'NOVAL', 'Cana Bay',
   'https://maps.app.goo.gl/SVUb2nH46gD5H2Gb6', 'Ing. Juan Ramon Oscena',
   E'Ubicación (Maps): https://maps.app.goo.gl/SVUb2nH46gD5H2Gb6\nIng. de obra: Ing. Juan Ramon Oscena / Ing. Roberly Camacho\nContacto: +1 809 351 8690 / +1 809 513 7467\nMaestro(s) encargado(s): Santo Perez (Argenis) / Danny Marte / Timot Elecomuse'),
  ('CSD-108', 'ROSCH - Edif Adm 911 (Distrito Nacional)', 'ROSCH', 'Distrito Nacional',
   'https://maps.app.goo.gl/q95GLYxY7aX6oKhm8', 'Ing. Manuel Guilamo',
   E'Ubicación (Maps): https://maps.app.goo.gl/q95GLYxY7aX6oKhm8\nIng. de obra: Ing. Manuel Guilamo / Jonathan Roman\nContacto: +1 809 315 0123 / +1 829 966 3040\nMaestro(s) encargado(s): Jorge Rosario'),
  ('CSD-109', 'VISTA CANA - Monterezzo (Vista Cana)', 'VISTA CANA', 'Vista Cana',
   'https://maps.app.goo.gl/XebZyPr2b4ANGpMM7', 'Ing. Emmanuel Peralta',
   E'Ubicación (Maps): https://maps.app.goo.gl/XebZyPr2b4ANGpMM7\nIng. de obra: Ing. Emmanuel Peralta\nContacto: +1 849 460 5156\nMaestro(s) encargado(s): Jose Nolasco (Pecho de Lata) / Personal de Varilleros')
) as v(codigo, nombre, cliente, ubicacion, maps, ing1, descripcion)
where not exists (select 1 from sgc.proyectos p where lower(p.nombre) = lower(v.nombre));

-- 3) Vincular ingenieros que SÍ existen como usuarios (para que vean sus proyectos).
--    Manuel Guilamo + Jonathan Roman → Torre Alpha y ROSCH 911.
insert into sgc.proyecto_responsables (proyecto_id, usuario_id, tipo_responsabilidad, activo)
select p.id, u.id, 'responsable', true
from sgc.proyectos p
cross join (values
  ('8244efdd-ac08-4df8-a7d8-6447ef57a11d'::uuid),  -- Manuel Guilamo
  ('c825029a-1136-49aa-8e9e-73d5be1ecd98'::uuid)   -- Jonathan Roman
) as u(id)
where (lower(p.nombre) = 'torre alpha' or lower(p.nombre) = lower('ROSCH - Edif Adm 911 (Distrito Nacional)'))
  and not exists (
    select 1 from sgc.proyecto_responsables r
    where r.proyecto_id = p.id and r.usuario_id = u.id
  );
