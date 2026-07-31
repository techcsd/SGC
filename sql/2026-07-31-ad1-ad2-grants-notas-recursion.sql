-- ============================================================================
-- AD1 + AD2 — Ronda 31/07/2026 (PROMPT-15 FASE 1)
-- ----------------------------------------------------------------------------
-- AD1: `permission denied for table ...` en tablas recientes (Y/Z/AA/AC) a las
--      que se les creó RLS + policies pero se OLVIDÓ el GRANT a `authenticated`.
--      Síntoma reportado: Reporte semanal (usuario almacén) ->
--      "permission denied for table flota_reporte_dias". Causa: la vista
--      v_reporte_semanal_cumplimiento es security_invoker y referencia
--      flota_reporte_dias, que no tenía GRANT SELECT a authenticated.
--
--      Auditoría (Management API) de TODAS las tablas de sgc: las siguientes
--      tienen policies (o se leen vía vista invoker / cliente) pero SIN grant a
--      authenticated. `activos`/`historial_activos`/`conductor_login_intentos`
--      quedan fuera a propósito: solo se tocan vía RPC SECURITY DEFINER / edge.
--
-- AD2: recursión infinita en las policies de `notas` <-> `nota_compartidos`
--      (cada policy consulta la otra tabla). Se corta con helpers SECURITY
--      DEFINER que leen sin re-aplicar RLS.
--
-- Todo aditivo e idempotente. Las policies ya existen y son correctas; aquí
-- solo se agregan GRANTs y se reescriben las de notas.
-- ============================================================================

-- ── AD2 — helpers SECURITY DEFINER para cortar la recursión ─────────────────
create or replace function sgc.puede_ver_nota(p_nota uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select exists (select 1 from sgc.notas n where n.id = p_nota and n.owner_id = p_uid)
      or exists (select 1 from sgc.nota_compartidos s where s.nota_id = p_nota and s.usuario_id = p_uid);
$$;

create or replace function sgc.puede_editar_nota(p_nota uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select exists (select 1 from sgc.notas n where n.id = p_nota and n.owner_id = p_uid)
      or exists (select 1 from sgc.nota_compartidos s
                 where s.nota_id = p_nota and s.usuario_id = p_uid and s.permiso = 'editar');
$$;

create or replace function sgc.es_owner_nota(p_nota uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select exists (select 1 from sgc.notas n where n.id = p_nota and n.owner_id = p_uid);
$$;

grant execute on function sgc.puede_ver_nota(uuid, uuid)   to authenticated;
grant execute on function sgc.puede_editar_nota(uuid, uuid) to authenticated;
grant execute on function sgc.es_owner_nota(uuid, uuid)     to authenticated;

-- ── AD2 — reescribir policies de notas (sin referencia circular) ────────────
drop policy if exists notas_sel on sgc.notas;
drop policy if exists notas_ins on sgc.notas;
drop policy if exists notas_upd on sgc.notas;
drop policy if exists notas_del on sgc.notas;

create policy notas_sel on sgc.notas for select to authenticated
  using (sgc.puede_ver_nota(id, auth.uid()));
create policy notas_ins on sgc.notas for insert to authenticated
  with check (owner_id = auth.uid());
create policy notas_upd on sgc.notas for update to authenticated
  using (sgc.puede_editar_nota(id, auth.uid()))
  with check (sgc.puede_editar_nota(id, auth.uid()));
create policy notas_del on sgc.notas for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists nota_comp_sel on sgc.nota_compartidos;
drop policy if exists nota_comp_ins on sgc.nota_compartidos;
drop policy if exists nota_comp_upd on sgc.nota_compartidos;
drop policy if exists nota_comp_del on sgc.nota_compartidos;

create policy nota_comp_sel on sgc.nota_compartidos for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_owner_nota(nota_id, auth.uid()));
create policy nota_comp_ins on sgc.nota_compartidos for insert to authenticated
  with check (sgc.es_owner_nota(nota_id, auth.uid()));
create policy nota_comp_upd on sgc.nota_compartidos for update to authenticated
  using (sgc.es_owner_nota(nota_id, auth.uid()))
  with check (sgc.es_owner_nota(nota_id, auth.uid()));
create policy nota_comp_del on sgc.nota_compartidos for delete to authenticated
  using (sgc.es_owner_nota(nota_id, auth.uid()));

-- ── AD1 — GRANTs faltantes (las policies ya gatean las filas) ───────────────
-- Notas: CRUD completo desde el cliente (create/update vía RPC guardar_nota,
-- pero granteamos full CRUD para el editor v2 AD9 y paridad app).
grant select, insert, update, delete on sgc.notas            to authenticated;
grant select, insert, update, delete on sgc.nota_compartidos to authenticated;

-- QA (Tecnología): policy FOR ALL gateada por es_tecnologia().
grant select, insert, update, delete on sgc.qa_test_cases       to authenticated;
grant select, insert, update, delete on sgc.qa_test_runs        to authenticated;
grant select, insert, update, delete on sgc.qa_test_run_results to authenticated;

-- Rutas AC13: paradas (sel/ins/del policies) y fotos (sel/ins policies).
grant select, insert, delete on sgc.ruta_paradas to authenticated;
grant select, insert         on sgc.ruta_fotos   to authenticated;

-- Conduces AC7: firmas (solo lectura desde el cliente; se crean vía RPC).
grant select on sgc.salida_firmas to authenticated;

-- Reporte semanal AC12/AC5: catálogo tipo_vehiculo -> día programado.
-- Se lee vía vista invoker; habilitamos RLS + lectura para authenticated.
alter table sgc.flota_reporte_dias enable row level security;
drop policy if exists flota_reporte_dias_sel on sgc.flota_reporte_dias;
create policy flota_reporte_dias_sel on sgc.flota_reporte_dias for select to authenticated
  using (true);
grant select on sgc.flota_reporte_dias to authenticated;

-- Nota: escrituras de flota_reporte_dias / qa (insert de corridas) siguen
-- por RPC SECURITY DEFINER; no se otorga más de lo necesario.
