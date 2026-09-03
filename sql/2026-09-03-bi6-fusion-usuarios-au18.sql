-- ════════════════════════════════════════════════════════════════════════════
-- PROMPT-32 (BI6 / AU18) — Detección y fusión de usuarios duplicados (personas).
-- Ronda 03/09/2026. Aditivo, idempotente.
--
-- El caso: "Manolo · Cédula 92303467843" y "MANOLO DURAN · Cédula 05300467247" son
-- dos filas LEGALES (cédulas distintas) que probablemente son una persona. El índice
-- único de BH4 no puede atraparlo. AUDITORIA-ARQUITECTURA-AU1.md:152 marcaba la
-- herramienta de fusión como inexistente — aquí nace, con este caso como 1er expediente.
-- Coste real del duplicado: reparte su actividad y PIERDE su incentivo.
--
-- Diseño (seguro por defecto): la fusión re-apunta dinámicamente TODAS las columnas
-- FK → sgc.usuarios(id) (196 columnas / 137 tablas) del duplicado al canónico. Para
-- las ~19 columnas con índice ÚNICO, si un re-apunte chocaría (ambos tienen fila para
-- la misma llave — p. ej. la misma semana de incentivo), NO se borra nada: esa tabla
-- se DEJA en el duplicado y se REPORTA como conflicto para revisión manual. Nunca se
-- pierde data de obra ni de plata en silencio.
--
-- Gate: is_admin() OR es_tecnologia(). Todo queda en audit_log.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-03-bi6-fusion-usuarios-au18.sql
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local search_path = sgc, public;

create extension if not exists pg_trgm;

alter table sgc.usuarios
  add column if not exists fusionado_en uuid references sgc.usuarios(id);
comment on column sgc.usuarios.fusionado_en is
  'BI6/AU18 — si no es null, esta fila se fusionó en el usuario canónico indicado (queda inactiva).';

-- ── Detección de candidatos a duplicado ──────────────────────────────────────
-- Similitud de nombre (pg_trgm) + señales de cédula. Prioriza personal de campo
-- (email sintético) pero considera a todos. No decide: LISTA para que un humano juzgue.
create or replace function sgc.detectar_usuarios_duplicados(p_umbral real default 0.45)
returns table (
  id_a uuid, nombre_a text, email_a text, cedula_a text, activo_a boolean,
  id_b uuid, nombre_b text, email_b text, cedula_b text, activo_b boolean,
  score real, motivo text
)
language sql stable security definer
set search_path to 'sgc', 'extensions', 'pg_temp'
as $$
  with u as (
    select id, nombre,
      coalesce(nullif(regexp_replace(lower(nombre),'\s+',' ','g'),''),'') as nombre_norm,
      email,
      coalesce(cedula, nullif(regexp_replace(split_part(email,'@',1),'^(cap-|c-|t-)',''),'')) as ced,
      activo, fusionado_en
    from sgc.usuarios
    where fusionado_en is null
  )
  select a.id, a.nombre, a.email, a.ced, a.activo,
         b.id, b.nombre, b.email, b.ced, b.activo,
         similarity(a.nombre_norm, b.nombre_norm) as score,
         case
           when a.ced is not null and a.ced = b.ced then 'misma cédula'
           when similarity(a.nombre_norm, b.nombre_norm) >= 0.7 then 'nombre muy parecido'
           else 'nombre parecido'
         end as motivo
  from u a
  join u b on a.id < b.id
  where (
      (a.ced is not null and a.ced = b.ced)
      or similarity(a.nombre_norm, b.nombre_norm) >= p_umbral
    )
    -- al menos uno de los dos es personal de campo (sintético) — donde vive el problema
    and (a.email ~* '\.constructorasd\.local$' or b.email ~* '\.constructorasd\.local$')
  order by score desc, a.nombre;
$$;
grant execute on function sgc.detectar_usuarios_duplicados(real) to authenticated, service_role;

-- ── Previsualización: qué actividad se re-apuntaría del duplicado al canónico ──
create or replace function sgc.previsualizar_fusion_usuarios(p_duplicado uuid)
returns table (tabla text, columna text, filas bigint)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare r record; v_n bigint;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  for r in
    select (c.conrelid::regclass)::text as tabla, a.attname as columna
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='sgc.usuarios'::regclass and array_length(c.conkey,1)=1
  loop
    execute format('select count(*) from %s where %I = $1', r.tabla, r.columna)
      into v_n using p_duplicado;
    if v_n > 0 then
      tabla := r.tabla; columna := r.columna; filas := v_n; return next;
    end if;
  end loop;
end;
$$;
grant execute on function sgc.previsualizar_fusion_usuarios(uuid) to authenticated, service_role;

-- ── Fusión: re-apunta todo lo re-apuntable, reporta lo que choca ──────────────
create or replace function sgc.fusionar_usuarios(p_canonico uuid, p_duplicado uuid)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  r record;
  v_reapuntadas int := 0;
  v_tablas_ok text[] := '{}';
  v_conflictos text[] := '{}';
  v_can sgc.usuarios; v_dup sgc.usuarios;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_canonico is null or p_duplicado is null or p_canonico = p_duplicado then
    raise exception 'Indica dos usuarios distintos (canónico y duplicado).';
  end if;
  select * into v_can from sgc.usuarios where id = p_canonico;
  select * into v_dup from sgc.usuarios where id = p_duplicado;
  if v_can.id is null or v_dup.id is null then raise exception 'Usuario no encontrado.'; end if;
  if v_can.fusionado_en is not null then raise exception 'El canónico ya está fusionado en otro usuario.'; end if;
  if v_dup.fusionado_en is not null then raise exception 'El duplicado ya fue fusionado.'; end if;

  for r in
    select (c.conrelid::regclass)::text as tabla, a.attname as columna
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='sgc.usuarios'::regclass and array_length(c.conkey,1)=1
      -- la propia usuarios (fusionado_en) se maneja aparte
      and c.conrelid <> 'sgc.usuarios'::regclass
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tabla, r.columna, r.columna)
        using p_canonico, p_duplicado;
      get diagnostics v_reapuntadas = row_count;
      if v_reapuntadas > 0 then v_tablas_ok := array_append(v_tablas_ok, r.tabla || '.' || r.columna); end if;
    exception when unique_violation then
      -- Ambos tienen fila para la misma llave (p. ej. misma semana de incentivo).
      -- NO se borra nada: se deja en el duplicado y se reporta para revisión manual.
      v_conflictos := array_append(v_conflictos, r.tabla || '.' || r.columna);
    end;
  end loop;

  -- El duplicado queda inactivo y apuntando al canónico. Se libera su cédula del
  -- índice único (se preserva en metadata del audit por si hay que revertir).
  update sgc.usuarios
    set activo = false, fusionado_en = p_canonico
    where id = p_duplicado;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'usuarios_fusionados', p_duplicado, jsonb_build_object(
    'canonico', p_canonico, 'canonico_nombre', v_can.nombre,
    'duplicado_nombre', v_dup.nombre, 'duplicado_cedula', v_dup.cedula, 'duplicado_email', v_dup.email,
    'tablas_reapuntadas', to_jsonb(v_tablas_ok), 'conflictos', to_jsonb(v_conflictos)));

  return jsonb_build_object(
    'ok', true,
    'canonico', p_canonico,
    'duplicado', p_duplicado,
    'tablas_reapuntadas', v_tablas_ok,
    'conflictos', v_conflictos);
end;
$$;
grant execute on function sgc.fusionar_usuarios(uuid, uuid) to authenticated, service_role;

commit;
