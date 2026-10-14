-- ============================================================================
-- CO2 — PROMPT-98 FASE 7 (14/10/2026) — Novedades a pantalla completa
-- "every user must see the update fixes when he join again" (#212).
--
-- `app_versiones` ya guarda las versiones con cambios curados (web+móvil); lo que
-- faltaba era (a) saber qué vio cada usuario y (b) unir un arreglo con quien lo
-- reportó ("arreglado para ti"). Fuentes de "arreglado para ti" confirmadas en
-- este repo: reportes de error (app_error_estados.resuelto_en_version, BI4),
-- consultas de Compa resueltas (assistant_consultas_no_atendidas, BE2), outbox
-- atascado resuelto (outbox_atascados, BG2). No existe una tabla de "tickets de
-- Soporte" separada en este repo — se omite esa fuente (no hay dónde leerla).
--
-- Aditivo e idempotente. Backfill de usuarios existentes: scripts/data-fixes/
-- 2026-10-14-co2-backfill-novedades.mjs (--dry-run por defecto).
-- ============================================================================
begin;
set local search_path = sgc, public;

alter table sgc.usuario_preferencias
  add column if not exists novedades_vista_web text,
  add column if not exists novedades_vista_app text;

-- CO2 — a qué usuarios va dirigido un cambio puntual (opcional; "esto es por lo
-- que me dijo X"). No cambia la forma existente de `cambios` (array de objetos),
-- solo documenta que cada objeto PUEDE traer `para: uuid[]`.
comment on column sgc.app_versiones.cambios is
  'Y1 — [{t,d,m?,para?}]: tipo, texto, módulo opcional, y (CO2) para: uuid[] de usuarios a los que este cambio responde directamente.';

create or replace function sgc.marcar_novedades_vistas(p_plataforma text, p_version text)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  if p_plataforma not in ('web','app') then
    raise exception 'Plataforma inválida: %', p_plataforma using errcode = '22023';
  end if;
  insert into sgc.usuario_preferencias (usuario_id) values (auth.uid())
    on conflict (usuario_id) do nothing;
  if p_plataforma = 'web' then
    update sgc.usuario_preferencias set novedades_vista_web = p_version where usuario_id = auth.uid();
  else
    update sgc.usuario_preferencias set novedades_vista_app = p_version where usuario_id = auth.uid();
  end if;
end;
$$;
grant execute on function sgc.marcar_novedades_vistas(text, text) to authenticated;

create or replace function sgc.novedades_pendientes(p_plataforma text)
returns jsonb
language plpgsql stable security definer set search_path = sgc, public
as $$
declare
  v_uid uuid := auth.uid();
  v_plat_versiones text := case when p_plataforma = 'web' then 'web' else 'movil' end;
  v_vista text;
  v_vista_code int;
  v_vista_at timestamptz;
  v_versiones jsonb;
  v_total int;
  v_arreglado jsonb;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  if p_plataforma not in ('web','app') then
    raise exception 'Plataforma inválida: %', p_plataforma using errcode = '22023';
  end if;

  select (case when p_plataforma = 'web' then novedades_vista_web else novedades_vista_app end)
    into v_vista
    from sgc.usuario_preferencias where usuario_id = v_uid;
  v_vista_code := case when v_vista is not null then sgc.semver_code(v_vista) else 0 end;

  -- CO2 — el web NUNCA marca `publicada` (cada deploy de Vercel es automáticamente
  -- "la versión actual"; ese flag solo existe para el rollout por etapas de la app
  -- móvil, Admin › Versiones). Filtrar por `publicada` en web dejaría Novedades
  -- siempre vacía — se exige el flag SOLO para 'movil'.
  select coalesce(max(publicada_at), max(created_at)) into v_vista_at
    from sgc.app_versiones where plataforma = v_plat_versiones and version = v_vista;

  select count(*) into v_total
    from sgc.app_versiones
   where (publicada or v_plat_versiones = 'web')
     and plataforma = v_plat_versiones and sgc.semver_code(version) > v_vista_code;

  select coalesce(jsonb_agg(x.fila order by x.vcode desc), '[]'::jsonb) into v_versiones
    from (
      select jsonb_build_object(
               'version', av.version, 'titulo', av.titulo, 'cambios', av.cambios,
               'fecha', av.fecha, 'url', av.url
             ) as fila,
             sgc.semver_code(av.version) as vcode
        from sgc.app_versiones av
       where (av.publicada or v_plat_versiones = 'web')
         and av.plataforma = v_plat_versiones and sgc.semver_code(av.version) > v_vista_code
       order by sgc.semver_code(av.version) desc
       limit 5
    ) x;

  -- "Arreglado para ti" — solo si ya tenía una vista previa (si es su primera vez,
  -- no hay "antes" con qué comparar; backfill deja a todos con una vista inicial).
  select coalesce(jsonb_agg(f.frase), '[]'::jsonb) into v_arreglado
    from (
      -- Errores de la app/web que este usuario reportó y ya se marcaron solucionados.
      select 'Arreglamos un error que reportaste: ' || left(coalesce(e.nota, r.message), 90) as frase
        from sgc.app_error_estados e
        join sgc.app_error_reports r on sgc.error_firma(r.message) = e.firma and r.user_id = v_uid
       where e.estado = 'solucionado' and e.resuelto_en_version is not null
         and sgc.semver_code(e.resuelto_en_version) > v_vista_code
       group by e.firma, e.nota, r.message
      union all
      -- Consultas de Compa que este usuario hizo y ya se atendieron.
      select 'Ya puedes hacer esto — resolvimos tu consulta: "' || left(c.pregunta, 90) || '"'
        from sgc.assistant_consultas_no_atendidas c
       where c.usuario_id = v_uid and c.resuelto and v_vista_at is not null and c.resuelto_at > v_vista_at
      union all
      -- Outbox atascado tuyo, ya resuelto.
      select 'Arreglamos un envío tuyo que se había atascado (' || o.tipo_op || ').'
        from sgc.outbox_atascados o
       where o.usuario_id = v_uid and o.resuelto and v_vista_at is not null and o.resuelto_en > v_vista_at
    ) f;

  return jsonb_build_object(
    'tiene_pendientes', (v_versiones != '[]'::jsonb or v_arreglado != '[]'::jsonb),
    'version_vista', v_vista,
    'versiones', v_versiones,
    'total_versiones', v_total,
    'hay_mas', v_total > jsonb_array_length(v_versiones),
    'arreglado_para_ti', v_arreglado
  );
end;
$$;
grant execute on function sgc.novedades_pendientes(text) to authenticated;

commit;
