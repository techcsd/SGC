-- ============================================================================
-- AC3 — Módulo QA (gestor de pruebas) dentro de Tecnología (30/07/2026)
-- ----------------------------------------------------------------------------
-- Casos de prueba por módulo + corridas (test runs) contra una versión + result-
-- ados por caso (passed/failed/blocked/skipped) con evidencia y link a reporte
-- de error. Gating: mismo que "Versiones de App" → sgc.es_tecnologia().
-- Modelo inspirado en TestRail/Qase/Zephyr (casos → plan/corrida → resultados).
-- ============================================================================

set search_path = sgc, public;

-- ── Casos de prueba ─────────────────────────────────────────────────────────
create table if not exists sgc.qa_test_cases (
  id                 uuid primary key default gen_random_uuid(),
  modulo             text not null,                       -- bitacora, flota, inventario, ...
  titulo             text not null,
  precondiciones     text,
  pasos              text,                                -- pasos (texto multilínea / numerado)
  resultado_esperado text,
  prioridad          text not null default 'media' check (prioridad in ('alta','media','baja')),
  plataforma         text not null default 'ambas' check (plataforma in ('web','app','ambas')),
  activo             boolean not null default true,
  orden              int not null default 0,
  creado_por         uuid references sgc.usuarios(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_qa_cases_modulo on sgc.qa_test_cases(modulo) where activo;

-- ── Corridas (test runs) ────────────────────────────────────────────────────
create table if not exists sgc.qa_test_runs (
  id               uuid primary key default gen_random_uuid(),
  titulo           text,
  plataforma       text not null default 'ambas' check (plataforma in ('web','app','ambas')),
  version_objetivo text,                                  -- p.ej. web 1.54.0 / app 1.25.0
  fecha            date not null default current_date,
  ejecutado_por    uuid references sgc.usuarios(id),
  estado           text not null default 'en_progreso' check (estado in ('en_progreso','completada','abortada')),
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── Resultados por caso dentro de una corrida ───────────────────────────────
create table if not exists sgc.qa_test_run_results (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references sgc.qa_test_runs(id) on delete cascade,
  caso_id         uuid references sgc.qa_test_cases(id) on delete set null,
  caso_titulo     text not null,                          -- snapshot (sobrevive al borrado del caso)
  modulo          text,                                   -- snapshot
  resultado       text not null default 'pendiente'
                    check (resultado in ('pendiente','passed','failed','blocked','skipped')),
  notas           text,
  evidencia_path  text,                                   -- bucket `qa`
  error_report_id uuid references sgc.app_error_reports(id) on delete set null,  -- AC3(e)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (run_id, caso_id)
);
create index if not exists idx_qa_results_run on sgc.qa_test_run_results(run_id);

-- ── RLS: todo el módulo QA reservado a Tecnología (es_tecnologia) ───────────
alter table sgc.qa_test_cases       enable row level security;
alter table sgc.qa_test_runs        enable row level security;
alter table sgc.qa_test_run_results enable row level security;

drop policy if exists qa_cases_all on sgc.qa_test_cases;
create policy qa_cases_all on sgc.qa_test_cases for all to authenticated
  using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());
drop policy if exists qa_runs_all on sgc.qa_test_runs;
create policy qa_runs_all on sgc.qa_test_runs for all to authenticated
  using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());
drop policy if exists qa_results_all on sgc.qa_test_run_results;
create policy qa_results_all on sgc.qa_test_run_results for all to authenticated
  using (sgc.es_tecnologia()) with check (sgc.es_tecnologia());

-- ── Bucket privado para evidencia de QA ─────────────────────────────────────
insert into storage.buckets (id, name, public) values ('qa','qa',false)
on conflict (id) do nothing;

drop policy if exists "qa evidencia read"  on storage.objects;
drop policy if exists "qa evidencia write" on storage.objects;
create policy "qa evidencia read" on storage.objects for select to authenticated
  using (bucket_id = 'qa' and sgc.es_tecnologia());
create policy "qa evidencia write" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa' and sgc.es_tecnologia());

-- ── RPC: crear corrida a partir de casos seleccionados (snapshot) ───────────
create or replace function sgc.qa_crear_corrida(
  p_plataforma text, p_version text, p_titulo text, p_caso_ids uuid[]
) returns uuid
language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare v_uid uuid := auth.uid(); v_run uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.es_tecnologia() then raise exception 'Solo Tecnología'; end if;

  insert into sgc.qa_test_runs (titulo, plataforma, version_objetivo, ejecutado_por)
  values (nullif(p_titulo,''), coalesce(nullif(p_plataforma,''),'ambas'), nullif(p_version,''), v_uid)
  returning id into v_run;

  insert into sgc.qa_test_run_results (run_id, caso_id, caso_titulo, modulo, resultado)
  select v_run, c.id, c.titulo, c.modulo, 'pendiente'
    from sgc.qa_test_cases c
   where c.id = any(coalesce(p_caso_ids, '{}')) and c.activo
   order by c.modulo, c.orden;

  return v_run;
end;
$$;
grant execute on function sgc.qa_crear_corrida(text, text, text, uuid[]) to authenticated, service_role;
