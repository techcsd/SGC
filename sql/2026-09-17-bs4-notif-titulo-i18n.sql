-- BS4 (v1 mínima) — notificaciones en el idioma del destinatario.
--
-- Alcance v1 (DEFAULT, ver HANDOFF §BS4): se localiza el TÍTULO de la notificación
-- IN-APP por destinatario (según `usuarios.idioma`), para los ~10 tipos más
-- frecuentes. El CUERPO y los mensajes de negocio (nombres, folios, DR481) siguen
-- en español — Configuración › Idioma lo dice. El push mantiene un único título por
-- lote (send_push no admite título por-usuario) → queda en español en v1.
--
-- Mecanismo: `notif_tipo.titulo_i18n jsonb` = { "en": "...", "ht": "..." }. Los dos
-- overloads de `notificar_modulo` eligen `titulo_i18n->>u.idioma` por destinatario y
-- caen al `p_titulo` (español, específico) si no hay traducción. Aditivo y seguro:
-- para un tipo sin `titulo_i18n` el comportamiento es idéntico al actual.

alter table sgc.notif_tipo add column if not exists titulo_i18n jsonb;

-- Semillas: los ~10 tipos más frecuentes. Título genérico traducido (v1) — cuando
-- exista, reemplaza el título en inglés/kreyòl; el español conserva el específico.
update sgc.notif_tipo t set titulo_i18n = s.j
from (values
  ('conduce_por_confirmar', '{"en":"Delivery to confirm","ht":"Livrezon pou konfime"}'::jsonb),
  ('ruta_asignada',         '{"en":"Route assigned","ht":"Wout asiyen"}'::jsonb),
  ('conduce',               '{"en":"Delivery note","ht":"Bon livrezon"}'::jsonb),
  ('entrega',               '{"en":"Delivery","ht":"Livrezon"}'::jsonb),
  ('tarea',                 '{"en":"Task","ht":"Travay"}'::jsonb),
  ('mensaje',               '{"en":"New message","ht":"Nouvo mesaj"}'::jsonb),
  ('solicitud_movimiento',  '{"en":"Movement request","ht":"Demann deplasman"}'::jsonb),
  ('combustible_revisar',   '{"en":"Fuel entry to review","ht":"Antre gazolin pou revize"}'::jsonb),
  ('recepcion_rechazada',   '{"en":"Reception rejected","ht":"Resepsyon refize"}'::jsonb),
  ('requisicion_vencida',   '{"en":"Overdue requisition","ht":"Rekizisyon an reta"}'::jsonb),
  ('version_publicada',     '{"en":"New version","ht":"Nouvo vèsyon"}'::jsonb),
  ('nota_compartida',       '{"en":"Shared note","ht":"Nòt pataje"}'::jsonb)
) as s(tipo, j)
where t.tipo = s.tipo;

-- ── notificar_modulo (5 args) — localiza el título por destinatario ──────────
create or replace function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select u.id, coalesce(p_tipo,'info'),
           -- BS4 — título en el idioma del destinatario si existe, si no el español.
           coalesce(nt.titulo_i18n ->> u.idioma, p_titulo),
           p_mensaje, p_ruta
    from sgc.usuarios u
    left join sgc.notif_tipo nt on nt.tipo = coalesce(p_tipo,'info')
    where u.activo and sgc.notif_permitida(u.id, coalesce(p_tipo,'info')) and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))
    returning usuario_id)
  select array_agg(usuario_id) into v_ids from ins;
  -- send_push recibe TODO el módulo (título único por lote → español en v1).
  perform sgc.send_push(
    (select array_agg(u.id) from sgc.usuarios u where u.activo and exists (
       select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
       where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
         and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta));
end $function$;

-- ── notificar_modulo (7 args) — idéntico + referencia ───────────────────────
create or replace function sgc.notificar_modulo(
  p_modulo text, p_tipo text, p_titulo text, p_mensaje text, p_ruta text,
  p_referencia_id uuid, p_referencia_tipo text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ids uuid[];
begin
  with ins as (
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_id, referencia_tipo)
    select u.id, coalesce(p_tipo,'info'),
           coalesce(nt.titulo_i18n ->> u.idioma, p_titulo),
           p_mensaje, p_ruta, p_referencia_id, p_referencia_tipo
    from sgc.usuarios u
    left join sgc.notif_tipo nt on nt.tipo = coalesce(p_tipo,'info')
    where u.activo and sgc.notif_permitida(u.id, coalesce(p_tipo,'info')) and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
        and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))
    returning usuario_id)
  select array_agg(usuario_id) into v_ids from ins;
  perform sgc.send_push(
    (select array_agg(u.id) from sgc.usuarios u where u.activo and exists (
       select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
       where ur.usuario_id = u.id and not coalesce(r.es_operativo,false)
         and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos)))),
    p_titulo, coalesce(p_mensaje,''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta,
      'referencia_id', p_referencia_id, 'referencia_tipo', p_referencia_tipo));
end $function$;
