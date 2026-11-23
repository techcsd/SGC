begin;
drop function if exists sgc.agregar_adjunto_reporte(uuid, text, text, text, bigint);
drop table if exists sgc.reportes_usuario_adjuntos;
update storage.buckets set file_size_limit = 15728640, allowed_mime_types = null where id = 'reportes';
commit;
