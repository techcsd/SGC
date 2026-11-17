-- DS-33 (ronda DS, 16-nov-2026) — #56/#73: SLA + escalamiento de solicitudes de material.
-- Aditiva. Todo editable en sgc.parametros. Escalamiento APAGADO por defecto (el issue pide entrevista
-- con Compras/Almacén): el valor del issue (48 h) queda como default, pero no avisa a nadie hasta que
-- un admin ponga sla_solicitud_material_activo = true (Administración › Parámetros).
--   node scripts/apply-migration.mjs sql/2026-11-16-ds33-parametros-ui-y-sla-solicitudes.sql --env dev
begin;
set local search_path = sgc, public;

-- ── 1) Parámetros ───────────────────────────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('sla_solicitud_material_activo', 'false', 'DS-33/#73: activa el escalamiento de solicitudes de material sin respuesta (apagado hasta entrevistar a Compras/Almacén).'),
  ('sla_solicitud_material_horas', '48', 'DS-33/#56: horas sin respuesta antes de escalar una solicitud de material pendiente.'),
  ('sla_solicitud_material_roles', 'jefe_almacen,admin', 'DS-33/#73: roles que reciben la escalada (CSV de códigos de rol).'),
  ('sla_solicitud_material_aviso_dias', '7', 'DS-33/#56: «pendientes de más de N días» para el KPI y el reporte.')
on conflict (clave) do nothing;

-- ── 2) Parámetros que la UI necesita leer (la RLS de parametros solo deja a admin/dirección) ──
-- Lista cerrada: solo flags de interfaz, nunca secretos ni umbrales internos.
create or replace function sgc.parametros_ui()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_object_agg(clave, valor), '{}'::jsonb)
    from sgc.parametros
   where clave in (
     'solicitud_movimiento_oculta',
     'solicitud_movimiento_aviso_legado',
     'conduce_qr_activo',
     'conduce_qr_vigencia_dias',
     'avisos_flota_informativos'
   );
$$;
grant execute on function sgc.parametros_ui() to authenticated, service_role;
comment on function sgc.parametros_ui() is 'DS-33 — flags de interfaz legibles por cualquier usuario autenticado (lista cerrada).';

-- ── 3) Marca de escalada (una sola vez por solicitud) ───────────────────────────
alter table sgc.solicitudes_material add column if not exists escalada_at timestamptz;
comment on column sgc.solicitudes_material.escalada_at is 'DS-33 — cuándo se escaló por SLA (null = nunca). Una sola escalada por solicitud.';

-- ── 4) Escalamiento (cron horario). service_role; respeta es_prueba y el flag ───────
create or replace function sgc.solicitudes_material_escalar()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_activo boolean := coalesce((select valor from sgc.parametros where clave = 'sla_solicitud_material_activo'), 'false') in ('true','t','1','si','sí');
  v_horas  int     := coalesce(nullif((select valor from sgc.parametros where clave = 'sla_solicitud_material_horas'), '')::int, 48);
  v_rec record; v_rol text; v_n int := 0; v_codigo text;
begin
  if not v_activo then return 0; end if;
  for v_rec in
    select s.id, s.folio, s.solicitante_id, s.created_at
      from sgc.solicitudes_material s
     where coalesce(s.estado, 'pendiente') = 'pendiente'
       and s.escalada_at is null
       and not coalesce(s.es_prueba, false)
       and s.created_at < now() - make_interval(hours => greatest(v_horas, 1))
  loop
    v_codigo := coalesce('REQ-' || lpad(v_rec.folio::text, 6, '0'), 'Una solicitud de material');
    foreach v_rol in array sgc.param_csv('sla_solicitud_material_roles', 'jefe_almacen,admin') loop
      perform sgc.notificar_rol(v_rol, 'warning', 'Solicitud de material sin respuesta',
        format('%s lleva más de %s h pendiente de aprobación. Revísala y aprueba o rechaza con motivo.', v_codigo, v_horas),
        '/inventario/requisiciones');
    end loop;
    if v_rec.solicitante_id is not null then
      perform sgc.notificar_usuarios(array[v_rec.solicitante_id], 'warning', 'Tu solicitud fue escalada',
        format('%s sigue pendiente; se avisó al responsable.', v_codigo), '/inventario/requisiciones', v_rec.id, 'requisicion');
    end if;
    update sgc.solicitudes_material set escalada_at = now() where id = v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
revoke execute on function sgc.solicitudes_material_escalar() from public, anon, authenticated;
grant execute on function sgc.solicitudes_material_escalar() to service_role;

do $$ begin perform cron.unschedule('sgc-solicitudes-material-escalar'); exception when others then null; end $$;
select cron.schedule('sgc-solicitudes-material-escalar', '20 * * * *', $cron$select sgc.solicitudes_material_escalar();$cron$);

-- ── 5) Reporte «más antiguas primero» (las 18 pendientes) + KPI ────────────────────
create or replace function sgc.solicitudes_material_pendientes_reporte()
returns table (id uuid, folio text, obra text, solicitante text, urgencia text, edad_horas int, escalada boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, 'REQ-' || lpad(s.folio::text, 6, '0'), p.nombre::text, u.nombre::text, s.urgencia::text,
         extract(epoch from now() - s.created_at)::int / 3600, s.escalada_at is not null
    from sgc.solicitudes_material s
    left join sgc.proyectos p on p.id = s.proyecto_id
    left join sgc.usuarios u on u.id = s.solicitante_id
   where (sgc.is_admin() or sgc.tiene_modulo('inventario'))
     and coalesce(s.estado, 'pendiente') = 'pendiente'
     and not coalesce(s.es_prueba, false)
   order by s.created_at asc
   limit 300;
$$;
grant execute on function sgc.solicitudes_material_pendientes_reporte() to authenticated;

create or replace function sgc.solicitudes_material_kpi()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('direccion') then
    jsonb_build_object(
      'pendientes', count(*),
      'mayores_n_dias', count(*) filter (where s.created_at < now() - make_interval(days =>
          coalesce(nullif((select valor from sgc.parametros where clave = 'sla_solicitud_material_aviso_dias'), '')::int, 7))),
      'mas_antigua_dias', coalesce(max(extract(day from now() - s.created_at))::int, 0))
  else '{}'::jsonb end
    from sgc.solicitudes_material s
   where coalesce(s.estado, 'pendiente') = 'pendiente' and not coalesce(s.es_prueba, false);
$$;
grant execute on function sgc.solicitudes_material_kpi() to authenticated;
commit;
