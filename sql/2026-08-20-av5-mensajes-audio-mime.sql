-- ════════════════════════════════════════════════════════════════════════════
-- AV5 — permitir audio (notas de voz) en el bucket de mensajería sgc-mensajes
-- ════════════════════════════════════════════════════════════════════════════
-- El chat v3 envía notas de voz (tipo 'audio') que suben a sgc-mensajes. El
-- allowlist de mime del bucket NO incluía audio → el upload fallaría. Se agregan
-- los formatos de audio (MediaRecorder produce webm/ogg en Android/Chromium y
-- mp4/m4a en iOS Safari). Aditivo: conserva los mime existentes (docs/imágenes).
-- ════════════════════════════════════════════════════════════════════════════

update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(
    coalesce(allowed_mime_types, '{}') ||
    array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/3gpp']
  )
)
where id = 'sgc-mensajes';
