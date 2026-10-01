-- CE16b — Índice único parcial por documento normalizado (tras fusionar duplicados)
-- ---------------------------------------------------------------------------------
-- Se aplica DESPUÉS de resolver los duplicados existentes (en prod lo revisa Xaviel
-- con la herramienta "Posibles duplicados" antes de correr esta migración). Evita que
-- vuelvan a entrar dos registros activos con el mismo documento. Excluye eliminados,
-- de prueba y sin documento, y usa la MISMA normalización que la detección/fusión.
-- ---------------------------------------------------------------------------------

create unique index if not exists uq_personal_obra_doc_norm
  on sgc.personal_obra (sgc.doc_normalizado(tipo_documento, documento_numero))
  where eliminado_at is null
    and not coalesce(es_prueba, false)
    and sgc.doc_normalizado(tipo_documento, documento_numero) is not null;
