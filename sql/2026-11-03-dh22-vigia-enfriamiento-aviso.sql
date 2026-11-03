-- DH22 — agente-vigia corre cada 5 min y, para cada envío atascado sin resolver,
-- notificaba al usuario en CADA corrida mientras siguiera atascado (sin registro
-- de "ya le avisé"), lo que podía repetir el mismo aviso muchas veces por hora
-- si el usuario no reabría la app. Enfriamiento: máximo 1 aviso cada 24h por
-- registro de outbox_atascados (la columna se actualiza SOLO cuando de verdad
-- se notifica — no en cada chequeo).

begin;

alter table sgc.outbox_atascados
  add column if not exists ultimo_aviso_at timestamptz;

comment on column sgc.outbox_atascados.ultimo_aviso_at is
  'DH22 — última vez que agente-vigia notificó a este usuario por este envío atascado. Enfriamiento: 1 aviso/24h.';

commit;
