-- ============================================================================
-- F5 (ronda DF) — RPCs del panel "Tecnología › Agentes" (decidir aprobación Nivel
-- 3, deshacer acción Nivel 2) + tabla/RPC del informe diario del Cronista.
-- Aditivo, fechado, idempotente. No toca tablas de negocio.
--
-- Gate de pantalla: tecnologiaGuard (admin OR sgc.es_tecnologia()) — igual que el
-- resto de la consola "Sistema" de Tecnología (monitoreo, QA, issues). No se creó
-- un módulo `agentes` nuevo en sgc.roles.modulos: el prompt pedía un permiso
-- "agentes.ver", pero el patrón real y ya establecido en este repo para páginas
-- sensibles de la consola de Tecnología es tecnologiaGuard, no un módulo granular
-- nuevo — evita duplicar el mismo gate con otro nombre (decisión documentada).
-- ============================================================================
begin;

-- ── 1) Decidir una propuesta del Escriba (Nivel 3) ─────────────────────────
-- "aprobada" SOLO marca el estado — nunca mezcla a main ni hace push/merge.
-- El merge real a dev lo hace Xaviel manualmente en GitHub (regla 18).
create or replace function sgc.decidir_agente_aprobacion(p_id uuid, p_decision text, p_nota text default null)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if p_decision not in ('aprobada','ajuste','descartada') then
    raise exception 'decision_invalida' using errcode = '22023';
  end if;
  update sgc.agente_aprobaciones
     set estado = p_decision,
         decidida_por = auth.uid(),
         decidida_en = now(),
         propuesta = case when p_decision = 'ajuste' and p_nota is not null
                          then propuesta || E'\n\n[Ajuste pedido] ' || p_nota
                          else propuesta end
   where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'aprobacion_no_pendiente' using errcode = 'P0002';
  end if;
end;
$function$;
grant execute on function sgc.decidir_agente_aprobacion(uuid, text, text) to authenticated;

-- ── 2) Deshacer una acción Nivel 2 ejecutada por un agente ─────────────────
-- Honesto: "deshacer" aquí marca la acción como deshecha y, cuando la acción
-- fue puramente un reintento de estado (p.ej. transcripción), no hay dato de
-- negocio que revertir. Si la acción fue una notificación ya enviada
-- (recordatorio de firma / envío atascado), deshacer NO retira esa notificación
-- — el front debe dejarlo explícito en el texto de confirmación (BS2).
create or replace function sgc.deshacer_agente_accion(p_id uuid)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  update sgc.agente_acciones
     set deshecha_en = now()
   where id = p_id and reversible = true and deshecha_en is null;
  if not found then
    raise exception 'accion_no_deshacible' using errcode = 'P0002';
  end if;
end;
$function$;
grant execute on function sgc.deshacer_agente_accion(uuid) to authenticated;

-- ── 3) Informe diario del Cronista ──────────────────────────────────────────
create table if not exists sgc.agente_informes_diarios (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null unique,
  contenido_md  text not null,
  enviado_en    timestamptz,
  creado_en     timestamptz not null default now()
);
comment on table sgc.agente_informes_diarios is 'F5 — informe diario del Cronista (SGC + CSD App). Se genera siempre por cron; "enviado_en" solo se llena con el clic de Xaviel, nunca solo.';

alter table sgc.agente_informes_diarios enable row level security;
drop policy if exists "agente_informes_diarios: ver" on sgc.agente_informes_diarios;
create policy "agente_informes_diarios: ver" on sgc.agente_informes_diarios for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.agente_informes_diarios to authenticated;
grant select, insert, update on sgc.agente_informes_diarios to service_role;

-- "Enviar a Eduardo": en este repo Eduardo se referencia siempre por ROL
-- configurable (mismo patrón que CW4 rendimiento-vehiculos), nunca por un id de
-- usuario fijo en SQL. Default: rol 'direccion' (ajustable sin migración vía
-- sgc.param_csv).
create or replace function sgc.agente_informe_enviar(p_id uuid)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fecha date;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  update sgc.agente_informes_diarios
     set enviado_en = now()
   where id = p_id and enviado_en is null
  returning fecha into v_fecha;
  if not found then
    raise exception 'informe_ya_enviado_o_inexistente' using errcode = 'P0002';
  end if;
  perform sgc.notificar_rol(
    r, 'agente_informe_diario',
    'Informe diario de Tecnología — ' || to_char(v_fecha, 'dd/mm/yyyy'),
    'El Cronista armó el resumen del día. Revísalo en Tecnología › Agentes.',
    '/tecnologia/agentes'
  )
  from unnest(sgc.param_csv('agente_informe_diario_roles', 'direccion')) as r;
end;
$function$;
grant execute on function sgc.agente_informe_enviar(uuid) to authenticated;

-- ── 4) Cron del Cronista — genera y guarda el informe, nunca lo envía ──────
-- 6:30pm hora RD (America/Santo_Domingo = UTC-4 todo el año, sin horario de
-- verano) = 22:30 UTC.
select cron.schedule('agente-cronista', '30 22 * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/agente-cronista',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);

commit;
