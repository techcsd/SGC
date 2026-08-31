-- =============================================================================
-- PROMPT-25 FASE 2 (BE2) — Chips (BA3) actualizados con las capacidades nuevas.
-- Ronda 19/08-01/09/2026 (IDs BE). Aditivo, idempotente, retrocompatible.
--
-- Las capturas piden a gritos: logística gana "¿Cómo van las rutas de hoy?",
-- los jefes ganan "¿Qué hizo hoy X?", ingenieros/almacén ganan "¿Dónde hay X?".
-- Añade además la persona 'jefe' (jefe de flota) — antes caía en 'default'.
-- =============================================================================

begin;

-- Nuevos chips por persona (idempotentes: solo si no existe ese texto para la persona).
insert into sgc.compa_chips (persona, texto, orden)
select v.persona, v.texto, v.orden
from (values
  -- Ingenieros / almacén — la consulta estrella de obra (apodos AU12).
  ('ingeniero', '¿Dónde hay puntales disponibles?', 5),
  -- Logística — el panorama de rutas + actividad del equipo.
  ('logistica', '¿Cómo van todas las rutas de hoy?', 4),
  ('logistica', '¿Qué hizo hoy un chofer?', 5),
  ('logistica', '¿Dónde hay un material disponible?', 6),
  -- Admin — panorama + actividad.
  ('admin', '¿Cómo van las rutas de hoy?', 5),
  ('admin', '¿Qué hizo hoy un usuario?', 6),
  -- Jefe de flota (persona nueva).
  ('jefe', '¿Cómo van todas las rutas de hoy?', 1),
  ('jefe', '¿Qué hizo hoy un chofer?', 2),
  ('jefe', '¿Qué vehículos están en uso?', 3),
  ('jefe', '¿Qué conduces hay por firmar?', 4),
  -- Default — jefes sin mapa específico igual ven el panorama.
  ('default', '¿Cómo van las rutas de hoy?', 4)
) as v(persona, texto, orden)
where not exists (
  select 1 from sgc.compa_chips c where c.persona = v.persona and c.texto = v.texto
);

-- Saludo/subtítulo para la persona 'jefe' (se toma del chip de menor orden).
update sgc.compa_chips
set saludo = '¡Hola! Soy Compa 👋',
    subtitulo = 'Pregúntame por las rutas del día, la actividad de tu equipo y la flota.'
where persona = 'jefe' and orden = 1 and saludo is null;

-- compa_sugerencias: añade la rama 'jefe' (jefe de flota) antes de 'logistica'.
create or replace function sgc.compa_sugerencias()
returns table(texto text, saludo text, subtitulo text, persona text)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_persona text;
begin
  select case
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'chofer_transportista') then 'chofer'
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo in ('ingeniero_campo','ingeniero_oficina','jefe_ingenieros','gerente_produccion')) then 'ingeniero'
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'jefe_flota') then 'jefe'
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'logistica') then 'logistica'
    when sgc.is_admin() then 'admin'
    else 'default' end
  into v_persona;

  return query
    select c.texto,
           first_value(c.saludo)    over (order by (c.saludo is null), c.orden) as saludo,
           first_value(c.subtitulo) over (order by (c.subtitulo is null), c.orden) as subtitulo,
           v_persona
    from sgc.compa_chips c
    where c.activo and c.persona = v_persona
    order by c.orden;
end;
$$;
grant execute on function sgc.compa_sugerencias() to authenticated, service_role;

commit;
