-- DJ — contenido de ayuda para "Grupos de WhatsApp (memoria IA)" (DB2), para
-- que Compa deje de adivinar cuando le preguntan por modo/confianza/adjuntos.
-- Encontrado en vivo (2026-11-09): Compa, al no encontrar este tema en
-- sgc.ayuda_contenido, adivinó la diferencia entre modo memoria/consulta y
-- se equivocó (dijo que "consulta también extrae datos" como si fuera algo
-- notable -- en realidad la extracción de hallazgos corre igual en AMBOS
-- modos; modo solo decide si el grupo puede preguntarle algo en vivo).
begin;

insert into sgc.ayuda_contenido (tipo, slug, contenido, modulo, orden)
values (
  'duda_categoria',
  'wa-grupos-memoria-ia',
  jsonb_build_object(
    'titulo', 'Grupos de WhatsApp (memoria IA)',
    'items', jsonb_build_array(
      jsonb_build_object(
        'pregunta', '¿Qué diferencia hay entre modo memoria, consulta e ignorar?',
        'respuesta', 'Los tres modos NO cambian si un grupo se guarda y se analiza -- eso pasa igual en memoria y en consulta: todo mensaje se guarda, y la IA extrae hallazgos (acuerdos, pedidos, montos, fechas) de los dos por igual. La única diferencia real es si el grupo puede preguntarle algo a Compa EN VIVO: en modo consulta, si alguien menciona al bot en el grupo, Compa responde usando SOLO el archivo de ese grupo; en modo memoria, el bot nunca contesta dentro del grupo (solo guarda y extrae, en silencio). Modo ignorar es la única excepción real: ese grupo no guarda nada, ni siquiera el texto.'
      ),
      jsonb_build_object(
        'pregunta', '¿Qué significa el número de confianza en un hallazgo?',
        'respuesta', 'Es un estimado de la IA (0 a 1) de qué tan segura está de haber extraído el hallazgo correctamente -- nunca un hecho confirmado. Un mensaje corto y ambiguo (sin fecha, sin monto, sin lugar) suele dar una confianza más baja (ej. 0.5-0.6) que uno con datos concretos. Siempre hay que leer el mensaje original antes de actuar sobre un hallazgo de confianza baja.'
      ),
      jsonb_build_object(
        'pregunta', '¿Por qué Compa no puede decirme de qué trataba una foto o un PDF enviado al grupo?',
        'respuesta', 'Depende del tipo de archivo. Una FOTO sí puede tener una descripción generada por IA (columna descripcion_media) -- si existe, aparece en las búsquedas de Compa igual que el texto. Un PDF o documento, hoy, NO se procesa: no se lee su contenido, así que buscar por su tema (ej. "cotización") no encuentra nada aunque el archivo se haya guardado bien. Para ver el archivo tal cual (foto o PDF), hay que abrirlo directo en Tecnología › Compa en WhatsApp › Archivo, pestaña con vista previa -- eso no pasa por Compa.'
      )
    )
  ),
  'tecnologia',
  50
)
on conflict (tipo, slug) do update set contenido = excluded.contenido, modulo = excluded.modulo, orden = excluded.orden, updated_at = now();

commit;
