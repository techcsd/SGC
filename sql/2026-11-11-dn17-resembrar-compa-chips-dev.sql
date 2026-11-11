-- DN-17 (ronda DN, PROMPT-142) — sgc.compa_chips estaba vacía en dev (0 filas)
-- pese a que sql/2026-08-26-ba-fase6-incentivo-flota-compa.sql y
-- sql/2026-08-31-be2-compa-chips-por-rol.sql figuran "aplicadas" en el ledger
-- de dev desde 2026-09-21 — el DML (delete+insert / insert-where-not-exists)
-- de esos 2 archivos nunca tuvo efecto real en dev (se verificó con SELECT
-- directo: count=0, ledger dice aplicada). Causa más probable: cuando el
-- proyecto sgc-dev se creó (PROMPT-58, BU1), el esquema se clonó por
-- introspección y el ledger se "back-filló" marcando archivos ya reflejados
-- en el esquema como aplicados, sin re-ejecutar su DML -- compa_chips (pura
-- semilla de datos, sin DDL dependiente de otra tabla) quedó fuera de la
-- siembra genérica de ~17k filas.
--
-- Esta migración NO reaplica los archivos originales (evita re-crear
-- funciones/políticas sin necesidad) -- solo reinserta los datos, con el
-- texto LIMPIO tal cual está en el archivo fuente del repo (confirmado sin
-- mojibake) -- no se copió el dato de prod porque prod mismo conserva hoy
-- mojibake sin corregir en la persona 'jefe' (sql/2026-10-26-cy-fix-compa-
-- chips-encoding.sql figura aplicada en prod pero sus UPDATE no tuvieron
-- efecto -- bug aparte, reportado, NO corregido en esta ronda: fuera de
-- alcance de DN-17, que es solo-dev).
--
-- Entorno: SOLO dev. Prod queda en solo lectura hasta que Xaviel decida (ver
-- HANDOFF). Idempotente: "insert ... where not exists" -- correr 2 veces no
-- duplica filas.
begin;
set local search_path = sgc, public;

insert into sgc.compa_chips (persona, texto, orden, saludo, subtitulo)
select v.persona, v.texto, v.orden, v.saludo, v.subtitulo
from (values
  ('chofer','¿Cuál es mi ruta de hoy?',1,'¡Hola! Soy Compa 👋'::text,'Pregúntame por tu ruta, conduces, firmas y tu puntaje de la semana.'::text),
  ('chofer','¿Tengo conduces pendientes?',2,null,null),
  ('chofer','¿Cómo va mi puntaje de la semana?',3,null,null),
  ('chofer','Registra una echada',4,null,null),
  ('ingeniero','¿Qué entregas tengo por confirmar?',1,'¡Hola! Soy Compa 👋','Pregúntame por tus entregas, requisiciones y tareas de obra.'),
  ('ingeniero','¿Cómo van mis requisiciones?',2,null,null),
  ('ingeniero','Crea una tarea en mi obra',3,null,null),
  ('ingeniero','¿En qué obras estoy?',4,null,null),
  ('ingeniero','¿Dónde hay puntales disponibles?',5,null,null),
  ('logistica','¿Qué requisiciones hay por despachar?',1,'¡Hola! Soy Compa 👋','Pregúntame por despachos, viajes de proveedores y la flota.'),
  ('logistica','¿Cuántos viajes hizo un proveedor este mes?',2,null,null),
  ('logistica','¿Qué conduces están por firmar?',3,null,null),
  ('logistica','¿Cómo van todas las rutas de hoy?',4,null,null),
  ('logistica','¿Qué hizo hoy un chofer?',5,null,null),
  ('logistica','¿Dónde hay un material disponible?',6,null,null),
  ('admin','¿Qué tareas tengo pendientes?',1,'¡Hola! Soy Compa 👋','Tu asistente de SGC — responde con datos reales, según lo que puedes ver.'),
  ('admin','¿Tengo conduces por firmar?',2,null,null),
  ('admin','¿En qué obras estoy?',3,null,null),
  ('admin','¿A qué tengo acceso en el sistema?',4,null,null),
  ('admin','¿Cómo van las rutas de hoy?',5,null,null),
  ('admin','¿Qué hizo hoy un usuario?',6,null,null),
  ('default','¿Qué tareas tengo pendientes?',1,'¡Hola! Soy Compa 👋','Pregúntame lo que necesites del sistema, con datos reales según lo que puedes ver.'),
  ('default','¿A qué tengo acceso en el sistema?',2,null,null),
  ('default','¿En qué obras estoy?',3,null,null),
  ('default','¿Cómo van las rutas de hoy?',4,null,null),
  ('jefe','¿Cómo van todas las rutas de hoy?',1,'¡Hola! Soy Compa 👋','Pregúntame por las rutas del día, la actividad de tu equipo y la flota.'),
  ('jefe','¿Qué hizo hoy un chofer?',2,null,null),
  ('jefe','¿Qué vehículos están en uso?',3,null,null),
  ('jefe','¿Qué conduces hay por firmar?',4,null,null)
) as v(persona, texto, orden, saludo, subtitulo)
where not exists (
  select 1 from sgc.compa_chips c where c.persona = v.persona and c.texto = v.texto
);

commit;
