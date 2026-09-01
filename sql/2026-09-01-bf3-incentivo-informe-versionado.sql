-- ════════════════════════════════════════════════════════════════════════════
-- BF3 — Reenviar el informe del incentivo CON los cambios (recalcular → regenerar
--   → reenviar), VERSIONADO y AUDITADO. Es materia de pago: cada envío guarda su
--   snapshot (quién estaba, puntajes, estado), quién reenvió y por qué. El correo
--   v2 dice "reemplaza al enviado el <fecha>". Destinatarios DIRIGIBLES (decisión
--   Xaviel) — por defecto los del informe; se pueden acotar al reenviar.
--   Las decisiones ya tomadas (aprobado/declinado) se conservan (tabla aparte,
--   append-only): el recálculo no las borra.
-- Aditivo. La edge `incentivo-semanal` acepta los campos nuevos (retrocompatible).
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── (1) Snapshot versionado de cada envío ───────────────────────────────────
create table if not exists sgc.incentivo_informe_version (
  id            uuid primary key default gen_random_uuid(),
  anio          int not null,
  semana        int not null,
  version       int not null,
  matriz        jsonb not null default '[]'::jsonb,   -- snapshot congelado de la matriz enviada
  destinatarios jsonb not null default '[]'::jsonb,   -- [{email,nombre}] a quienes se envió
  motivo        text,                                  -- obligatorio a partir de v2
  reemplaza_version int,                               -- la versión anterior que reemplaza
  reemplaza_fecha   timestamptz,                        -- cuándo se envió esa anterior
  enviado_por   uuid references sgc.usuarios(id),
  enviado_en    timestamptz not null default now(),
  unique (anio, semana, version)
);
comment on table sgc.incentivo_informe_version is
  'BF3 — historial versionado de cada envío del informe de incentivo (snapshot congelado, quién reenvió y por qué). Materia de pago.';
create index if not exists ix_incentivo_informe_version on sgc.incentivo_informe_version (anio, semana, version desc);

alter table sgc.incentivo_informe_version enable row level security;
do $$ begin
  create policy incentivo_informe_version_sel on sgc.incentivo_informe_version
    for select using (sgc.is_admin() or sgc.puede_gestionar_incentivos());
exception when duplicate_object then null; end $$;
grant select, insert on sgc.incentivo_informe_version to authenticated, service_role;

-- ── (2) Reenviar (recalcular → snapshot v(n) → enviar dirigido) ─────────────
create or replace function sgc.incentivo_reenviar_version(
  p_anio         int,
  p_semana       int,
  p_motivo       text  default null,
  p_destinatarios jsonb default null   -- null = destinatarios por defecto del informe
) returns jsonb
language plpgsql security definer set search_path = sgc, public as $$
declare
  v_secret     text;
  v_url        text;
  v_version    int;
  v_prev_ver   int;
  v_prev_fecha timestamptz;
  v_matriz     jsonb;
  v_dest       jsonb;
begin
  if not sgc.puede_gestionar_incentivos() then
    raise exception 'No autorizado para reenviar el informe.' using errcode = '42501';
  end if;

  -- Recalcula con el estado ACTUAL (población/pesos/incidencias). Las decisiones
  -- aprobado/declinado viven en incentivo_aprobacion (append-only) → se conservan.
  perform sgc.incentivo_generar_semana(p_anio, p_semana);

  -- Versión previa (para "reemplaza al enviado el …").
  select version, enviado_en into v_prev_ver, v_prev_fecha
    from sgc.incentivo_informe_version
   where anio = p_anio and semana = p_semana
   order by version desc limit 1;

  v_version := coalesce(v_prev_ver, 0) + 1;

  -- A partir de v2 el motivo es OBLIGATORIO (es materia de pago).
  if v_version > 1 and coalesce(nullif(trim(p_motivo), ''), '') = '' then
    raise exception 'El motivo del reenvío es obligatorio.' using errcode = 'BF3MO';
  end if;

  -- Snapshot congelado de la matriz que se envía.
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_matriz
    from sgc.incentivo_matriz_email(p_anio, p_semana) m;

  -- Destinatarios: dirigidos (si vienen) o los del informe por defecto.
  if p_destinatarios is not null and jsonb_typeof(p_destinatarios) = 'array'
     and jsonb_array_length(p_destinatarios) > 0 then
    v_dest := p_destinatarios;
  else
    select coalesce(jsonb_agg(jsonb_build_object('email', d.email, 'nombre', d.nombre)), '[]'::jsonb)
      into v_dest from sgc.destinatarios_informe_incentivo() d;
  end if;

  insert into sgc.incentivo_informe_version
    (anio, semana, version, matriz, destinatarios, motivo, reemplaza_version, reemplaza_fecha, enviado_por)
  values
    (p_anio, p_semana, v_version, v_matriz, v_dest, nullif(trim(p_motivo), ''),
     v_prev_ver, v_prev_fecha, auth.uid());

  -- Dispara la edge con los campos de versión (retrocompatible).
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  v_url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/incentivo-semanal';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
    body := jsonb_build_object(
      'anio', p_anio, 'semana', p_semana,
      'version', v_version,
      'reemplaza_fecha', v_prev_fecha,
      'motivo', nullif(trim(p_motivo), ''),
      'destinatarios', v_dest
    )
  );

  return jsonb_build_object(
    'version', v_version, 'reemplaza_version', v_prev_ver,
    'destinatarios', jsonb_array_length(v_dest)
  );
end;
$$;
grant execute on function sgc.incentivo_reenviar_version(int, int, text, jsonb) to authenticated, service_role;

-- ── (3) Historial de versiones enviadas (para la UI) ────────────────────────
create or replace function sgc.incentivo_versiones(p_anio int, p_semana int)
returns table(
  version int, motivo text, reemplaza_version int, reemplaza_fecha timestamptz,
  destinatarios jsonb, enviado_por text, enviado_en timestamptz, n_choferes int
)
language sql stable security definer set search_path = sgc, public as $$
  select v.version, v.motivo, v.reemplaza_version, v.reemplaza_fecha,
         v.destinatarios, u.nombre, v.enviado_en,
         coalesce(jsonb_array_length(v.matriz), 0)
    from sgc.incentivo_informe_version v
    left join sgc.usuarios u on u.id = v.enviado_por
   where v.anio = p_anio and v.semana = p_semana
     and (sgc.is_admin() or sgc.puede_gestionar_incentivos())
   order by v.version desc;
$$;
grant execute on function sgc.incentivo_versiones(int, int) to authenticated, service_role;

commit;
