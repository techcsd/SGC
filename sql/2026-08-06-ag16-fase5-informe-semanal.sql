-- ============================================================================
-- AG16 · Gestión de Producción de Obra — FASE 5: Informe semanal de obra a
-- Gerencia. Rutina 10 del Gerente de Producción.
--
-- Reutiliza `informes_semanales` (ola2) EXTENDIDA con estructura + auto-compilado.
-- `compilar_informe_semanal` junta del sistema: avance (FASE 4), NC abiertas/
-- cerradas, incidentes, pedidos urgentes/pendientes, fotos de bitácoras de la
-- semana, mano de obra, pruebas de campo. + campos manuales del gerente.
-- `enviar_informe_semanal` marca enviado y notifica a Gerencia (in-app + push +
-- email best-effort vía edge `generar-informe-obra`, patrón AG14).
--
-- Aditivo/retrocompatible. RLS: obra + proyectos + bitacora + admin + submódulo
-- obra.informes.
-- ============================================================================
set search_path = sgc, public;

-- ── Extensión estructurada de informes_semanales ──
alter table sgc.informes_semanales
  add column if not exists periodo_inicio  date,
  add column if not exists periodo_fin     date,
  add column if not exists secciones       jsonb not null default '{}'::jsonb,
  add column if not exists campos_manuales jsonb not null default '{}'::jsonb,
  add column if not exists estado          text not null default 'borrador',
  add column if not exists pdf_path        text,
  add column if not exists enviado_en      timestamptz,
  add column if not exists enviado_por     uuid references sgc.usuarios(id);

do $$ begin
  alter table sgc.informes_semanales add constraint informes_estado_chk
    check (estado in ('borrador','enviado'));
exception when duplicate_object then null; end $$;

-- Un informe por obra+período (para el upsert del compilado).
create unique index if not exists uq_informe_obra_periodo
  on sgc.informes_semanales (proyecto_id, periodo_inicio, periodo_fin)
  where periodo_inicio is not null;

-- ── RLS: ampliar a obra + submódulo obra.informes ──
drop policy if exists informes_semanales_all on sgc.informes_semanales;
create policy informes_semanales_all on sgc.informes_semanales for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_ver_submodulo('obra.informes'))
  with check (sgc.is_admin() or sgc.tiene_modulo('obra') or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora') or sgc.puede_operar_submodulo('obra.informes'));

-- ── Config de notificación ──
insert into sgc.notificaciones_config (evento, descripcion, in_app, push, email) values
  ('obra_informe_enviado', 'Informe semanal de obra enviado a Gerencia', true, true, true)
on conflict (evento) do nothing;

-- ── Auto-compilado del informe (idempotente por obra+período; no pisa lo enviado) ──
create or replace function sgc.compilar_informe_semanal(
  p_proyecto_id uuid, p_periodo_inicio date, p_periodo_fin date
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare
  v_id uuid; v_av record; v_sec jsonb; v_fotos jsonb; v_incidentes jsonb; v_nc_crit jsonb;
  v_nc_abiertas int; v_nc_cerradas int; v_pedidos int; v_horas numeric; v_pruebas int; v_bitas int;
begin
  select * into v_av from sgc.calcular_avance_obra(p_proyecto_id);

  select count(*) into v_nc_abiertas from sgc.obra_no_conformidades
    where proyecto_id = p_proyecto_id and estado in ('abierta','en_correccion');
  select count(*) into v_nc_cerradas from sgc.obra_no_conformidades
    where proyecto_id = p_proyecto_id and estado = 'cerrada'
      and cerrada_en::date between p_periodo_inicio and p_periodo_fin;

  select coalesce(jsonb_agg(jsonb_build_object('titulo', coalesce(titulo, descripcion), 'severidad', severidad, 'tipo', tipo)), '[]'::jsonb)
    into v_nc_crit from sgc.obra_no_conformidades
    where proyecto_id = p_proyecto_id and estado in ('abierta','en_correccion') and severidad in ('alta','critica');

  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'descripcion', descripcion, 'gravedad', gravedad, 'fecha', fecha)), '[]'::jsonb)
    into v_incidentes from sgc.obra_incidentes
    where proyecto_id = p_proyecto_id and fecha between p_periodo_inicio and p_periodo_fin;

  select count(*) into v_pedidos from sgc.solicitudes_material
    where proyecto_id = p_proyecto_id and (urgencia = 'urgente' or estado = 'pendiente');

  select coalesce(sum(horas_hombre), 0) into v_horas from sgc.obra_mano_obra
    where proyecto_id = p_proyecto_id and fecha between p_periodo_inicio and p_periodo_fin;

  select count(*) into v_pruebas from sgc.obra_pruebas_campo
    where proyecto_id = p_proyecto_id and fecha between p_periodo_inicio and p_periodo_fin;

  select count(distinct b.id) into v_bitas from sgc.bitacoras b
    where b.proyecto_id = p_proyecto_id and b.fecha between p_periodo_inicio and p_periodo_fin;

  -- Fotos de las bitácoras de la semana (hasta 12, solo imágenes).
  select coalesce(jsonb_agg(x.url), '[]'::jsonb) into v_fotos from (
    select ba.url from sgc.bitacora_archivos ba
    join sgc.bitacoras b on b.id = ba.bitacora_id
    where b.proyecto_id = p_proyecto_id and b.fecha between p_periodo_inicio and p_periodo_fin
      and coalesce(ba.tipo_mime,'') like 'image/%'
    order by ba.created_at desc limit 12
  ) x;

  v_sec := jsonb_build_object(
    'avance_plan_pct', v_av.avance_plan_pct,
    'avance_real_pct', v_av.avance_real_pct,
    'nc_abiertas', v_nc_abiertas,
    'nc_cerradas', v_nc_cerradas,
    'nc_criticas', v_nc_crit,
    'incidentes', v_incidentes,
    'pedidos_pendientes', v_pedidos,
    'horas_hombre', v_horas,
    'pruebas_campo', v_pruebas,
    'bitacoras', v_bitas,
    'fotos', v_fotos
  );

  insert into sgc.informes_semanales
    (proyecto_id, fecha, periodo_inicio, periodo_fin, secciones, avance_pct, estado, creado_por)
  values
    (p_proyecto_id, current_date, p_periodo_inicio, p_periodo_fin, v_sec, v_av.avance_real_pct, 'borrador', auth.uid())
  on conflict (proyecto_id, periodo_inicio, periodo_fin) where periodo_inicio is not null
  do update set
    secciones = excluded.secciones,
    avance_pct = excluded.avance_pct
  where sgc.informes_semanales.estado = 'borrador'
  returning id into v_id;

  -- Si el conflicto era un informe ya enviado, no se actualiza: recupera su id.
  if v_id is null then
    select id into v_id from sgc.informes_semanales
      where proyecto_id = p_proyecto_id and periodo_inicio = p_periodo_inicio and periodo_fin = p_periodo_fin;
  end if;
  return v_id;
end $$;
grant execute on function sgc.compilar_informe_semanal(uuid,date,date) to authenticated, service_role;

-- ── Guardar campos manuales del gerente ──
create or replace function sgc.guardar_informe_manual(p_id uuid, p_campos jsonb, p_contenido text default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  update sgc.informes_semanales
    set campos_manuales = coalesce(p_campos, campos_manuales),
        contenido = coalesce(p_contenido, contenido)
    where id = p_id and estado = 'borrador';
end $$;
grant execute on function sgc.guardar_informe_manual(uuid,jsonb,text) to authenticated, service_role;

-- ── Enviar a Gerencia (in-app + push; email best-effort vía edge) ──
create or replace function sgc.enviar_informe_semanal(p_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp','extensions','public' as $$
declare v_proy uuid; v_uid uuid; v_nombre text; v_secret text; v_url text;
begin
  update sgc.informes_semanales
    set estado = 'enviado', enviado_en = now(), enviado_por = auth.uid()
    where id = p_id and estado = 'borrador'
    returning proyecto_id into v_proy;
  if v_proy is null then return; end if;

  select nombre into v_nombre from sgc.proyectos where id = v_proy;

  -- Notificar a Gerencia/Dirección (in-app + push).
  if sgc.obra_notif_activo('obra_informe_enviado','in_app') then
    for v_uid in
      select distinct u.id from sgc.usuarios u
      join sgc.usuarios_roles ur on ur.usuario_id = u.id
      join sgc.roles r on r.id = ur.rol_id
      where coalesce(u.activo,true) and ('direccion' = any(r.modulos) or 'admin' = any(r.modulos)
        or exists (select 1 from unnest(r.modulos) m where m = 'proyectos') and r.codigo in ('gerencia','direccion'))
    loop
      perform sgc.notificar(v_uid, 'info', 'Informe semanal de obra',
        'Nuevo informe semanal de ' || coalesce(v_nombre,'obra') || '.', '/obra/informes');
    end loop;
  end if;

  -- Email con PDF adjunto (best-effort): dispara el edge generar-informe-obra.
  -- No-opea si el edge no está desplegado o falta el secreto (no rompe el envío).
  -- URL fija del proyecto (mismo patrón que AG14/notificar-soporte).
  begin
    if sgc.obra_notif_activo('obra_informe_enviado','email') then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret' limit 1;
      if v_secret is not null then
        perform net.http_post(
          url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/generar-informe-obra',
          headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
          body := jsonb_build_object('informe_id', p_id)
        );
      end if;
    end if;
  exception when others then null; end;
end $$;
grant execute on function sgc.enviar_informe_semanal(uuid) to authenticated, service_role;

-- ── Listado de informes por obra ──
create or replace function sgc.informes_de_obra(p_proyecto_id uuid)
returns setof sgc.informes_semanales
language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select * from sgc.informes_semanales
  where proyecto_id = p_proyecto_id and periodo_inicio is not null
  order by periodo_inicio desc;
$$;
grant execute on function sgc.informes_de_obra(uuid) to authenticated, service_role;
