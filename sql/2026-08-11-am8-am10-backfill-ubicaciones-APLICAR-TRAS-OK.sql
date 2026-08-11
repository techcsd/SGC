-- =============================================================================
-- AM8 + AM10 — BACKFILL de ubicaciones y campos estructurados de proyectos.
-- ⚠️  APLICAR SOLO TRAS EL OK DE XAVIEL (revisión de la lista abajo). Ronda AM.
-- Coordenadas resueltas server-side desde el link de Google Maps de cada
-- descripción (marcador !3d!4d / /search). Los campos ingeniero_obra / contacto /
-- maestro_encargado se extrajeron de la descripción; la descripción queda limpia
-- (era 100% data estructurada). Idempotente: solo rellena si sigue vacío.
-- Requiere haber corrido antes: 2026-08-11-am7-am10-proyecto-ubicacion-campos-estructurados.sql
-- =============================================================================
begin;

-- CSD-101 — ASA - Residencial Romo (Cap Cana)   (18.513607, -68.395219)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.513607), longitud = coalesce(longitud, -68.395219),
  direccion_geo = 'https://maps.app.goo.gl/XsmdNv1JmVQLqJKCA',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Arq. Bernabel Ortiz'),
  contacto_telefono = coalesce(contacto_telefono, '+1 809 271 9751'),
  maestro_encargado = coalesce(maestro_encargado, 'Victor Bautista (Yolanda)'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = '1a96bd52-becf-490d-876e-31d60ed20b0f';

-- CSD-102 — BATCON - Interplaza (San Pedro de MacorÃ­s)   (18.460066, -69.281785)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.460066), longitud = coalesce(longitud, -69.281785),
  direccion_geo = 'https://maps.app.goo.gl/HjFt7pYZ3BFkKSms5',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Ing. Ivan Lapaix'),
  contacto_telefono = coalesce(contacto_telefono, '+1 829 855 5651'),
  maestro_encargado = coalesce(maestro_encargado, 'Prin Roy / Franklin'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = '8b98074e-594e-40a0-9033-7ccc791ab05d';

-- CSD-103 — BEST IN PRO - City Place (Punta Cana)   (18.631354, -68.386059)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.631354), longitud = coalesce(longitud, -68.386059),
  direccion_geo = 'https://maps.app.goo.gl/bfwhgz5QUhE8eSPm9',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Ing. Abraham Mercedez'),
  contacto_telefono = coalesce(contacto_telefono, '+1 829 958 1269'),
  maestro_encargado = coalesce(maestro_encargado, 'Antonio Urbaez'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = 'a48fe5df-84e7-47f0-a642-b295fab642eb';

-- CSD-104 — BLUEWAVE - Olea (Cap Cana)   (18.470375, -68.405167)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.470375), longitud = coalesce(longitud, -68.405167),
  direccion_geo = 'https://maps.app.goo.gl/64weY9ydXBYUVAJY6',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Arq. Bernabel Ortiz'),
  contacto_telefono = coalesce(contacto_telefono, '+1 809 298 1731'),
  maestro_encargado = coalesce(maestro_encargado, 'Antonio Urbaez'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = 'a4383130-6ab7-4799-b9d7-f943fb0cb1d7';

-- CSD-105 — BLUEWAVE - Volares (Cap Cana)   (18.467899, -68.414473)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.467899), longitud = coalesce(longitud, -68.414473),
  direccion_geo = 'https://maps.app.goo.gl/XZdgudmYZCu3KW59A',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Arq. Bernabel Ortiz'),
  contacto_telefono = coalesce(contacto_telefono, '+1 809 271 9751'),
  maestro_encargado = coalesce(maestro_encargado, 'Franklin'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = '07743451-2b56-4e8b-9d1b-cf72e2820173';

-- CSD-106 — NOVAL - Poseidonia (Cana Bay)   (18.723546, -68.489705)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.723546), longitud = coalesce(longitud, -68.489705),
  direccion_geo = 'https://maps.app.goo.gl/4aoyaTX4Yxm9MGZZ8',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Ing. Juan Ramon Oscena / Ing. Esperanza Diaz'),
  contacto_telefono = coalesce(contacto_telefono, '+1 809 351 8690 / +1 829 901 3559'),
  maestro_encargado = coalesce(maestro_encargado, 'Victor Bautista (Yolanda) / Edito Vargas'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = 'd46244b2-6ca1-4a11-b914-4feb91662f46';

-- CSD-107 — NOVAL - Riviera Bay (Cana Bay)   (18.731789, -68.487050)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.731789), longitud = coalesce(longitud, -68.487050),
  direccion_geo = 'https://maps.app.goo.gl/SVUb2nH46gD5H2Gb6',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Ing. Juan Ramon Oscena / Ing. Roberly Camacho'),
  contacto_telefono = coalesce(contacto_telefono, '+1 809 351 8690 / +1 809 513 7467'),
  maestro_encargado = coalesce(maestro_encargado, 'Santo Perez (Argenis) / Danny Marte / Timot Elecomuse'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = '313fbf47-2894-411c-9031-cfc68d39f7ae';

-- CSD-108 — ROSCH - Edif Adm 911 (Distrito Nacional)   (18.460054, -69.926516)
update sgc.proyectos set
  latitud = coalesce(latitud, 18.460054), longitud = coalesce(longitud, -69.926516),
  direccion_geo = 'https://maps.app.goo.gl/q95GLYxY7aX6oKhm8',
  ubicacion_metodo = coalesce(ubicacion_metodo, 'backfill'),
  ingeniero_obra = coalesce(ingeniero_obra, 'Ing. Manuel Guilamo / Jonathan Roman'),
  contacto_telefono = coalesce(contacto_telefono, '+1 809 315 0123 / +1 829 966 3040'),
  maestro_encargado = coalesce(maestro_encargado, 'Jorge Rosario'),
  descripcion = null,   -- la descripción era 100% data estructurada ya promovida
  updated_at = now()
where id = '9dd6fa1e-1a32-4a1e-b851-d0f015830af0';

commit;