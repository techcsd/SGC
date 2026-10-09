-- 2026-10-08-ck5b-guias-tutoriales.sql
-- CK5 — guías visuales nuevas en sgc.ayuda_contenido para los videos de "cómo hacer".
-- Mismo shape que GuiaVisual (dudas-content.ts). Aparecen en Dudas con sus pasos de texto;
-- el script de subida (scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs) les añade
-- después los campos de video (video_path/poster_path/vtt_path/duracion_s/plataforma).
-- Aditivo. Idempotente por (tipo, slug): al re-correr refresca el texto pero PRESERVA los
-- campos de video ya subidos.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck5b-guias-tutoriales.sql --env dev
-- (El guion 'web-crear-conduce' reusa la guía existente 'conduce' — no se siembra aquí.)

begin;

insert into sgc.ayuda_contenido (tipo, slug, contenido, modulo, orden) values
  ('guia', 'apoyo-transporte',
   '{"id":"apoyo-transporte","titulo":"Apoyo de transporte","icono":"inventario","pasos":[
     "Entra a Transporte → Apoyo de transporte y toca «Nuevo apoyo».",
     "Elige el tipo: movimiento interno, retiro de material o bote.",
     "Selecciona la obra y el día.",
     "Escribe qué hay que mover (basta una nota) y sube una foto.",
     "Toca «Crear apoyo»: tú mismo cambias su estado cuando termine."]}'::jsonb,
   null, 60),
  ('guia', 'requisicion',
   '{"id":"requisicion","titulo":"Aprobar y despachar una requisición","icono":"inventario","modulo":"inventario","pasos":[
     "Inventario → Requisiciones: abre la requisición pendiente.",
     "Revisa cada renglón y mapéalo a un artículo del catálogo.",
     "Elige el almacén desde el que se despacha.",
     "Aprueba: se despacha lo disponible y se pide compra del faltante.",
     "Genera el conduce para la entrega en la obra."]}'::jsonb,
   'inventario', 61),
  ('guia', 'conduce-externo',
   '{"id":"conduce-externo","titulo":"Conduce externo desde una requisición","icono":"conduce","modulo":"inventario","pasos":[
     "Abre la requisición y toca «Asignar conduce externo».",
     "Crea uno nuevo o vincula un conduce externo existente.",
     "Completa transportista, placa y la foto del material.",
     "Al confirmarse, el material entra al inventario de la obra."]}'::jsonb,
   'inventario', 62),
  ('guia', 'transferir-conduce',
   '{"id":"transferir-conduce","titulo":"Transferir o reasignar un conduce","icono":"conduce","modulo":"inventario","pasos":[
     "Abre el conduce (Inventario → Salidas → Conduce).",
     "Usa «Transferir» para pasarlo a otro chofer.",
     "En «Entregar a» asigna o cambia quién recibe en la obra.",
     "El receptor recibe el aviso para confirmar la entrega."]}'::jsonb,
   'inventario', 63),
  ('guia', 'mantenimiento',
   '{"id":"mantenimiento","titulo":"Registrar un mantenimiento","icono":"preuso","modulo":"flota","pasos":[
     "Flota → Mantenimientos → Nuevo mantenimiento.",
     "Elige el vehículo y el taller (o escribe «Otro»).",
     "Escribe el kilometraje; el sistema valida que sea coherente.",
     "Adjunta la factura o el informe (PDF o foto) con su tipo.",
     "Guarda: el costo y el odómetro se actualizan."]}'::jsonb,
   'flota', 64),
  ('guia', 'chofer-privado',
   '{"id":"chofer-privado","titulo":"Autorizar un chofer privado","icono":"preuso","modulo":"flota","pasos":[
     "Flota → Conductores → Choferes privados.",
     "Toca «Autorizar vehículos» en el chofer.",
     "Elige uno o varios vehículos y una vigencia opcional.",
     "El chofer ya puede tomar y soltar esos vehículos."]}'::jsonb,
   'flota', 65),
  ('guia', 'mis-choferes',
   '{"id":"mis-choferes","titulo":"Seguir a tus choferes (Mis choferes)","icono":"preuso","modulo":"flota","pasos":[
     "Transporte → Trabajos de transporte: asigna un chofer a cada ticket.",
     "Transporte → Mis choferes: ve el estado de cada uno.",
     "Cada tarjeta muestra su trabajo actual y su última señal.",
     "El chofer reporta desde la app (voy, llegué, terminé)."]}'::jsonb,
   'flota', 66)
on conflict (tipo, slug) do update
  set contenido = excluded.contenido || coalesce(
        (select jsonb_object_agg(k, v) from jsonb_each(sgc.ayuda_contenido.contenido) e(k, v)
         where k in ('video_path','poster_path','vtt_path','duracion_s','plataforma')),
        '{}'::jsonb),
      modulo = excluded.modulo,
      orden = excluded.orden,
      activo = true,
      updated_at = now();

commit;
