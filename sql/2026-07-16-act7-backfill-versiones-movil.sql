-- ============================================================================
-- Actualización 7 — Y1 backfill: entradas móvil en texto corrido → estructura
-- ----------------------------------------------------------------------------
-- Solo 4 entradas quedaron sin `titulo`/`cambios` (las demás ya estaban
-- estructuradas): móvil 1.7.0, 1.7.1, 1.7.2, 1.8.0. Se parsea su `notas` en
-- cambios tipados {t,d} sin perder información. Solo rellena si sigue vacío
-- (idempotente). `notas` se conserva como respaldo (la UI usa chips cuando hay
-- cambios). >>> Aplicar SOLO tras aprobación de Xaviel. <<<
-- ============================================================================

set search_path = sgc, public;

-- 1.7.0 — Bitácora al día con la web + fotos en lote
update sgc.app_versiones set
  titulo = 'Bitácora al día con la web + fotos en lote',
  cambios = '[
    {"t":"nuevo","d":"Agrega todas las fotos que quieras a la bitácora, de la cámara o de la galería (en lote)."},
    {"t":"nuevo","d":"Registra los equipos alquilados en uso hoy (equipo, en qué se usó, proveedor); queda respaldado y visible en el detalle."},
    {"t":"mejora","d":"Bitácora al día con la web: bloque/entrepiso, ingeniero responsable, hora de fin de trabajo, subcontratista y acciones del incidente."},
    {"t":"mejora","d":"Las notas de la ruta ahora se ven en la tarjeta de la ruta."}
  ]'::jsonb
where plataforma='movil' and version='1.7.0' and coalesce(jsonb_array_length(cambios),0)=0;

-- 1.7.1 — Estabilidad y envíos
update sgc.app_versiones set
  titulo = 'Estabilidad y envíos',
  cambios = '[
    {"t":"arreglo","d":"La cantidad ya no se pierde al pedir EPP con talla."},
    {"t":"arreglo","d":"La barra «toca para reintentar» ahora reintenta de verdad los envíos con problema."},
    {"t":"arreglo","d":"Kilometraje incoherente bloqueado en reporte semanal y checklist (evita envíos atascados)."},
    {"t":"arreglo","d":"Compartir por WhatsApp ya no muestra error si cancelas."},
    {"t":"mejora","d":"Los checklists de liberación e incidente preguntan antes de salir para no perder lo escrito."},
    {"t":"mejora","d":"Más detalles legibles: fechas con hora, km con separador, estado de ruta e intentos de PIN."}
  ]'::jsonb
where plataforma='movil' and version='1.7.1' and coalesce(jsonb_array_length(cambios),0)=0;

-- 1.7.2 — Skeletons de carga (parche sobre 1.7.1)
update sgc.app_versiones set
  titulo = 'Skeletons de carga',
  cambios = '[
    {"t":"mejora","d":"Las pantallas de combustible, checklist y mantenimiento muestran carga (skeleton) en vez de datos vacíos."}
  ]'::jsonb
where plataforma='movil' and version='1.7.2' and coalesce(jsonb_array_length(cambios),0)=0;

-- 1.8.0 — Documentos del conductor y del vehículo
update sgc.app_versiones set
  titulo = 'Documentos del conductor y del vehículo',
  cambios = '[
    {"t":"nuevo","d":"Sube tus documentos (cédula y licencia) desde la app, con foto o archivo/PDF; al registrarte como conductor o luego desde «Mi actividad»."},
    {"t":"nuevo","d":"Aviso de «Documentos pendientes» mientras falte tu cédula o licencia (no bloquea)."},
    {"t":"nuevo","d":"Documentos del vehículo (seguro, matrícula) visibles en el perfil del vehículo."},
    {"t":"mejora","d":"Al recibir o devolver un vehículo se avisa si no se pudo tomar la ubicación (GPS) y puedes reintentar; el registro nunca se bloquea."}
  ]'::jsonb
where plataforma='movil' and version='1.8.0' and coalesce(jsonb_array_length(cambios),0)=0;
