-- ============================================================================
-- DG7 — Papelera de 30 días para imágenes quitadas de una nota. Antes,
-- `borrarImagenNota` (notas.service.ts) borraba el archivo de Storage al
-- instante en cuanto se confirmaba «Quitar» en el editor (nota-imagen.extension.ts).
-- Ahora esa confirmación solo ARCHIVA la ruta aquí; el archivo real se borra
-- SOLO cuando lo hace el cron `sgc-purgar-imagenes-notas` (edge
-- `purgar-imagenes-notas`), 30 días después. Esto habilita "Deshacer" (el undo
-- del editor) y la lista "Imágenes quitadas (N)" sin haber perdido el archivo.
--
-- Regla 19: leí `sgc.puede_editar_nota(uuid)` (2026-07-30-ac4-notas-module.sql) —
-- dueño de la nota O compartida con permiso 'editar'. La RLS de esta tabla
-- calca ese MISMO criterio (recuperar una imagen es una edición de la nota).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-02-dg7-imagenes-quitadas.sql --env dev  →  --env prod
-- ============================================================================

begin;

-- `purgar_en` NO es columna generada: `timestamptz + interval` es STABLE (depende
-- del TimeZone de sesión por el cálculo calendario), no IMMUTABLE, y Postgres
-- rechaza STABLE en `generated always as` (42P17). En su lugar, el DEFAULT se
-- calcula en el mismo INSERT que `quitada_en` (mismo `now()` de la transacción).
create table if not exists sgc.nota_imagenes_quitadas (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references sgc.notas(id) on delete cascade,
  ruta_storage text not null,
  quitada_en timestamptz not null default now(),
  quitada_por uuid references sgc.usuarios(id) on delete set null,
  purgar_en timestamptz not null default (now() + interval '30 days')
);
create index if not exists idx_nota_imagenes_quitadas_nota on sgc.nota_imagenes_quitadas(nota_id);
create index if not exists idx_nota_imagenes_quitadas_purgar on sgc.nota_imagenes_quitadas(purgar_en);
comment on table sgc.nota_imagenes_quitadas is 'DG7 — papelera de 30 días de imágenes quitadas de sgc.notas; el cron sgc-purgar-imagenes-notas borra el archivo de Storage + la fila tras purgar_en.';

alter table sgc.nota_imagenes_quitadas enable row level security;

-- Mismo criterio dueño/compartida-editable que sgc.notas (sgc.puede_editar_nota,
-- overload de 1 arg que usa auth.uid() internamente).
drop policy if exists nota_imagenes_quitadas_sel on sgc.nota_imagenes_quitadas;
create policy nota_imagenes_quitadas_sel on sgc.nota_imagenes_quitadas
  for select to authenticated using (sgc.puede_editar_nota(nota_id));

drop policy if exists nota_imagenes_quitadas_ins on sgc.nota_imagenes_quitadas;
create policy nota_imagenes_quitadas_ins on sgc.nota_imagenes_quitadas
  for insert to authenticated with check (sgc.puede_editar_nota(nota_id));

drop policy if exists nota_imagenes_quitadas_del on sgc.nota_imagenes_quitadas;
create policy nota_imagenes_quitadas_del on sgc.nota_imagenes_quitadas
  for delete to authenticated using (sgc.puede_editar_nota(nota_id));

grant select, insert, delete on sgc.nota_imagenes_quitadas to authenticated;
-- El cron (edge `purgar-imagenes-notas`, service role) lee y borra sin pasar por
-- RLS (BYPASSRLS), pero igual necesita el GRANT de tabla (gotcha recurrente:
-- "permission denied for table …" — RLS bypass y privilegios de tabla son cosas
-- distintas).
grant select, delete on sgc.nota_imagenes_quitadas to service_role;

-- ── Cron diario: dispara la edge `purgar-imagenes-notas` (service role) que
-- borra el archivo real del bucket `notas-imagenes` + la fila, para toda fila
-- con purgar_en < now(). Mismo patrón que el resto de crons (BU1 — URL/secreto
-- salen de sgc.edge_base_url()/vault, nunca un ref hardcodeado). ──────────────
select cron.schedule('sgc-purgar-imagenes-notas', '45 4 * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/purgar-imagenes-notas',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);

commit;
