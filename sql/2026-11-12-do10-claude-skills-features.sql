-- 2026-11-12-do10-claude-skills-features.sql
-- Ronda DO (DO7, DO-10) — módulo Skills: ámbito "equipo/departamento", guard de
-- aprobador para ámbito "empresa", métricas simples (descargas + rating), y la
-- base para "Compa sugiere skills" (RPC sgc.claude_skills_sugerir). Aditivo
-- sobre sgc.claude_skills (sql/2026-11-10-dm1-claude-modulo.sql).
--   node scripts/apply-migration.mjs sql/2026-11-12-do10-claude-skills-features.sql --env dev

begin;

-- ── (b) Ámbito "equipo/departamento" + (c) métricas simples ────────────────────────
alter table sgc.claude_skills drop constraint if exists claude_skills_ambito_check;
alter table sgc.claude_skills add constraint claude_skills_ambito_check
  check (ambito in ('personal','rol','empresa','equipo'));
alter table sgc.claude_skills add column if not exists equipo text;
alter table sgc.claude_skills add column if not exists descargas int not null default 0;
alter table sgc.claude_skills add column if not exists rating_positivo int not null default 0;
alter table sgc.claude_skills add column if not exists rating_negativo int not null default 0;
comment on column sgc.claude_skills.equipo is 'DO-10 — departamento (sgc.empleados.departamento) cuando ambito=equipo; null en los demás ámbitos.';

-- Única fuente de verdad de "¿puede este usuario VER esta skill?" — reusada por
-- la política de SELECT y por los RPCs de descargas/rating (regla: no duplicar
-- la regla de permisos).
create or replace function sgc.claude_skill_visible(p_skill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = sgc, pg_temp
as $$
  select exists (
    select 1 from sgc.claude_skills s
    where s.id = p_skill_id
      and (
        s.owner_id = auth.uid()
        or sgc.puede_ver_submodulo('tecnologia.claude_administrar')
        or (s.estado = 'publicada' and (
              s.ambito = 'empresa'
              or (s.ambito = 'rol' and exists (
                    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                    where ur.usuario_id = auth.uid() and r.codigo = any(s.roles)))
              or (s.ambito = 'equipo' and (
                    sgc.es_tecnologia()
                    or exists (select 1 from sgc.empleados e where e.usuario_id = auth.uid() and e.departamento = s.equipo)))
            ))
      )
  );
$$;
grant execute on function sgc.claude_skill_visible(uuid) to authenticated;

drop policy if exists "claude_skills: ver" on sgc.claude_skills;
create policy "claude_skills: ver" on sgc.claude_skills for select to authenticated
  using (sgc.claude_skill_visible(id));

-- ── (a) Guard: ámbito "empresa" solo lo publica Tecnología/Gerencia ────────────────
-- (antes, cualquiera con tecnologia.claude_administrar podía publicar a toda la
-- empresa; ese submódulo se puede asignar a otros roles desde Administración).
create or replace function sgc.claude_skill_decidir(p_skill_id uuid, p_decision text, p_motivo text default null)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_ambito text;
begin
  if not sgc.puede_operar_submodulo('tecnologia.claude_administrar') then
    raise exception 'Sin permiso para aprobar skills.' using errcode = '42501';
  end if;
  if p_decision not in ('publicada','borrador','archivada') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  select ambito into v_ambito from sgc.claude_skills where id = p_skill_id;
  if v_ambito is null then raise exception 'Skill no encontrada.' using errcode = 'P0002'; end if;
  if p_decision = 'publicada' and v_ambito = 'empresa' and not sgc.es_tecnologia() then
    raise exception 'Solo Tecnología o Gerencia puede publicar una skill a toda la empresa.' using errcode = '42501';
  end if;
  update sgc.claude_skills
     set estado = p_decision,
         motivo_devuelta = case when p_decision = 'borrador' then p_motivo else null end,
         updated_at = now()
   where id = p_skill_id;
end;
$function$;
grant execute on function sgc.claude_skill_decidir(uuid, text, text) to authenticated;

-- ── (b) claude_skill_proponer ahora acepta ámbito "equipo" + el nombre del equipo ──
-- DN13/CD10 — cambia la firma (nuevo parámetro): se dropea la vieja explícitamente
-- para no dejar un overload ambiguo de 2 argumentos sin la lógica de equipo.
drop function if exists sgc.claude_skill_proponer(uuid, text);
create or replace function sgc.claude_skill_proponer(p_skill_id uuid, p_ambito text, p_equipo text default null)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_owner uuid; v_estado text; v_codigo boolean;
begin
  select owner_id, estado, tiene_codigo_ejecutable into v_owner, v_estado, v_codigo
    from sgc.claude_skills where id = p_skill_id;
  if v_owner is null then raise exception 'Skill no encontrada.' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() then raise exception 'Solo el dueño puede proponerla.' using errcode = '42501'; end if;
  if p_ambito not in ('rol','empresa','equipo') then raise exception 'Ámbito inválido.' using errcode = '22023'; end if;
  if p_ambito = 'equipo' and coalesce(nullif(trim(p_equipo),''), null) is null then
    raise exception 'Indica el equipo/departamento.' using errcode = '22023';
  end if;
  update sgc.claude_skills
     set ambito = p_ambito,
         equipo = case when p_ambito = 'equipo' then trim(p_equipo) else null end,
         estado = case when v_codigo then 'requiere_revision' else 'propuesta' end,
         updated_at = now()
   where id = p_skill_id;
end;
$function$;
grant execute on function sgc.claude_skill_proponer(uuid, text, text) to authenticated;

-- ── (c) Métricas simples: descargas + rating 👍/👎 ─────────────────────────────────
create or replace function sgc.claude_skill_registrar_descarga(p_skill_id uuid)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.claude_skill_visible(p_skill_id) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  update sgc.claude_skills set descargas = descargas + 1 where id = p_skill_id;
end;
$function$;
grant execute on function sgc.claude_skill_registrar_descarga(uuid) to authenticated;

create or replace function sgc.claude_skill_calificar(p_skill_id uuid, p_valor text)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.claude_skill_visible(p_skill_id) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  if p_valor not in ('positivo','negativo') then raise exception 'Valor inválido.' using errcode = '22023'; end if;
  if p_valor = 'positivo' then
    update sgc.claude_skills set rating_positivo = rating_positivo + 1 where id = p_skill_id;
  else
    update sgc.claude_skills set rating_negativo = rating_negativo + 1 where id = p_skill_id;
  end if;
end;
$function$;
grant execute on function sgc.claude_skill_calificar(uuid, text) to authenticated;

-- ── (d) Compa sugiere skills — v1 por coincidencia de tags/título ──────────────────
-- SECURITY INVOKER (default, sin "security definer"): corre con los permisos del
-- que llama, así que el filtro de "publicada" + RLS de ambito/rol/equipo de
-- claude_skills se aplica solo — ni un herramienta de Compa ni este RPC
-- necesitan reimplementar esa visibilidad.
create or replace function sgc.claude_skills_sugerir(p_texto text, p_limite int default 3)
returns table(id uuid, slug text, nombre text, descripcion text, score int)
language sql
stable
set search_path = sgc, pg_temp
as $$
  with palabras as (
    select distinct lower(trim(w)) as palabra
    from unnest(regexp_split_to_array(coalesce(p_texto, ''), '\s+')) as w
    where length(trim(w)) >= 4
  ), puntuadas as (
    select s.id, s.slug, s.nombre, s.descripcion, s.updated_at,
      ( coalesce((select count(*) from palabras p join unnest(s.tags) as tg on lower(tg) = p.palabra), 0) * 2
      + coalesce((select count(*) from palabras p where position(p.palabra in lower(s.nombre)) > 0), 0)
      )::int as score
    from sgc.claude_skills s
    where s.estado = 'publicada'
  )
  select id, slug, nombre, descripcion, score from puntuadas
  where score > 0
  order by score desc, updated_at desc
  limit greatest(1, least(coalesce(p_limite, 3), 5));
$$;
grant execute on function sgc.claude_skills_sugerir(text, int) to authenticated;

commit;
