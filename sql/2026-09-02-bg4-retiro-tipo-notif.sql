-- PROMPT-28 (BG) FASE 4 — registra el tipo de notificación 'retiro_material' en el
-- catálogo administrable (BF4b), para que un admin pueda regular su envío por rol.
-- crear_retiro_material ya emite este tipo; esto solo lo hace tunable. Idempotente.
-- Reproduce el catálogo vigente (incl. outbox_atascado de BG2) + añade retiro_material.
create or replace function sgc.notif_tipos_catalogo()
returns table(tipo text, etiqueta text, es_operativa boolean)
language sql stable as $$
  select * from (values
    ('version_publicada','Nuevas versiones', false),
    ('material_no_catalogado','Material no catalogado', false),
    ('otros_valor','Valores fuera de catálogo', false),
    ('solicitud_movimiento','Solicitudes de movimiento', false),
    ('flota','Avisos de flota', false),
    ('transporte','Transporte y rutas', false),
    ('conduce','Conduces', false),
    ('novedad','Novedades', false),
    ('consumo_anormal','Consumo anómalo', true),
    ('ruta_asignada','Ruta asignada', true),
    ('conduce_por_confirmar','Conduce por confirmar', true),
    ('outbox_atascado','Registros atascados (outbox)', true),
    ('retiro_material','Retiro de material dañado', true)
  ) as t(tipo, etiqueta, es_operativa);
$$;
grant execute on function sgc.notif_tipos_catalogo() to authenticated;
