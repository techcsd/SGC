-- ============================================================================
-- PROMPT-48 (BP) FASE 5 — BP5: "Dev notes" reutilizando sgc.notas.
-- Ronda 14/09/2026.  Aditivo, idempotente, retrocompatible.
--
-- Añade `ambito` (general|dev), `formato` (html|markdown) y `tags[]` a las notas.
-- Las notas `ambito='dev'` SOLO las ven usuarios `es_tecnologia()` — aunque estén
-- compartidas con alguien que no lo sea (la RLS es el límite de seguridad; la UI
-- además limita "compartir con…" al directorio de tecnología).
--
-- guardar_nota gana p_ambito/p_formato/p_tags (defaults) — se DROPEA el overload viejo
-- de 7 args y se crea el de 10 para no dejar ambigüedad de overload (gotcha AY6).
-- Solo el OWNER puede cambiar el ámbito de una nota.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp5-notas-ambito-dev.sql
-- ============================================================================
begin;

alter table sgc.notas add column if not exists ambito  text not null default 'general'
  check (ambito in ('general','dev'));
alter table sgc.notas add column if not exists formato text not null default 'html'
  check (formato in ('html','markdown'));
alter table sgc.notas add column if not exists tags    text[] not null default '{}';

create index if not exists ix_notas_owner_ambito on sgc.notas (owner_id, ambito) where not archivada;
create index if not exists ix_notas_dev_fts on sgc.notas
  using gin (to_tsvector('spanish', coalesce(titulo,'') || ' ' || coalesce(contenido,'')))
  where ambito = 'dev';

-- RLS: una nota 'dev' solo la ve tecnología (aunque esté compartida).
drop policy if exists notas_sel on sgc.notas;
create policy notas_sel on sgc.notas for select to authenticated
  using (sgc.puede_ver_nota(id, auth.uid()) and (ambito <> 'dev' or sgc.es_tecnologia()));

-- guardar_nota con ámbito/formato/tags. Copia verbatim del cuerpo vivo + campos nuevos.
drop function if exists sgc.guardar_nota(uuid, text, text, text, boolean, boolean, timestamptz);
create or replace function sgc.guardar_nota(
  p_id uuid, p_titulo text, p_contenido text,
  p_color text default null, p_pinned boolean default null, p_archivada boolean default null,
  p_expected_updated_at timestamptz default null,
  p_ambito text default null, p_formato text default null, p_tags text[] default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_srv timestamptz; v_conflict boolean := false; v_owner uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if not exists (select 1 from sgc.notas where id = p_id) then
    -- Crear (owner = quien llama). Solo tecnología puede crear notas 'dev'.
    if coalesce(p_ambito,'general') = 'dev' and not sgc.es_tecnologia() then
      raise exception 'Solo Tecnología puede crear notas de desarrollo' using errcode='22023';
    end if;
    insert into sgc.notas (id, owner_id, titulo, contenido, color, pinned, archivada, ambito, formato, tags)
    values (p_id, v_uid, coalesce(p_titulo,''), coalesce(p_contenido,''),
            nullif(p_color,''), coalesce(p_pinned,false), coalesce(p_archivada,false),
            coalesce(p_ambito,'general'), coalesce(p_formato,'html'), coalesce(p_tags,'{}'));
    return jsonb_build_object('conflict', false,
      'nota', (select to_jsonb(n) from sgc.notas n where n.id = p_id));
  end if;

  if not sgc.puede_editar_nota(p_id) then raise exception 'No tienes permiso para editar esta nota'; end if;

  select updated_at, owner_id into v_srv, v_owner from sgc.notas where id = p_id;
  if p_expected_updated_at is not null and v_srv is not null and v_srv > p_expected_updated_at then
    v_conflict := true;   -- otro editó después; se avisa pero última edición gana
  end if;

  update sgc.notas set
    titulo    = coalesce(p_titulo, titulo),
    contenido = coalesce(p_contenido, contenido),
    color     = case when p_color is null then color else nullif(p_color,'') end,
    pinned    = coalesce(p_pinned, pinned),
    archivada = coalesce(p_archivada, archivada),
    -- Solo el OWNER cambia el ámbito.
    ambito    = case when p_ambito is not null and v_uid = v_owner then p_ambito else ambito end,
    formato   = coalesce(p_formato, formato),
    tags      = coalesce(p_tags, tags),
    updated_at = now()
  where id = p_id;

  return jsonb_build_object('conflict', v_conflict,
    'nota', (select to_jsonb(n) from sgc.notas n where n.id = p_id));
end;
$function$;

grant execute on function sgc.guardar_nota(uuid, text, text, text, boolean, boolean, timestamptz, text, text, text[]) to authenticated;

commit;
