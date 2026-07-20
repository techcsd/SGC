-- ============================================================================
-- Q5 — Firmas de liberación (CL): cliente y MIVHED opcionales, firma por foto
--       (20/07/2026)
-- ----------------------------------------------------------------------------
-- Migración ADITIVA y RETROCOMPATIBLE.
--
--   1. Las firmas OBLIGATORIAS pasan a ser SOLO residente + responsable
--      (cliente y mivhed opcionales) → `trg_cl_firmado` con umbral de 2.
--   2. Columna aditiva `metodo` en cl_registro_firmas ('pad' | 'foto') para
--      distinguir firma dibujada vs foto de la firma en papel.
--   3. `registrar_cl_app` (app) acepta `metodo` dentro del jsonb de firmas.
--   4. La "regla de oro" (`trg_nc_bloquea_vaciado`) NO cambia: sigue exigiendo
--      un CL en estado 'firmado', que ahora se alcanza con las 2 obligatorias.
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Método de la firma (dibujada en pad o foto de la firma en papel) ─────
alter table sgc.cl_registro_firmas
  add column if not exists metodo text not null default 'pad';
do $$ begin
  alter table sgc.cl_registro_firmas
    add constraint cl_registro_firmas_metodo_chk check (metodo in ('pad','foto'));
exception when duplicate_object then null; end $$;
comment on column sgc.cl_registro_firmas.metodo is
  'Origen de la firma: pad (trazo) | foto (imagen de la firma en papel).';

-- ── 2) Trigger: un CL pasa a 'firmado' con residente + responsable ──────────
-- (cliente y mivhed dejan de ser obligatorias — Q5). Los CL viejos ya en
-- 'firmado' no se tocan (la condición exige estado <> 'firmado').
create or replace function sgc.trg_cl_firmado() returns trigger language plpgsql
set search_path to 'sgc','pg_temp' as $$
begin
  update sgc.cl_registros r set estado='firmado', updated_at=now()
  where r.id = NEW.registro_id and r.estado <> 'firmado'
    and (select count(distinct rol) from sgc.cl_registro_firmas f
         where f.registro_id = r.id and f.rol in ('residente','responsable')) >= 2;
  return NEW;
end; $$;
-- El trigger ya existe (trg_cl_firma); create or replace de la función basta.

-- ── 3) registrar_cl_app (app): aceptar `metodo` en el jsonb de firmas ───────
-- Misma firma; solo se añade la lectura de s->>'metodo' (default 'pad').
create or replace function sgc.registrar_cl_app(
  p_id uuid, p_proyecto_id uuid, p_plantilla_id uuid, p_elemento_id uuid, p_vaciado_id uuid,
  p_bloque text, p_eje text, p_plano_path text, p_observaciones text,
  p_items jsonb, p_fotos jsonb, p_firmas jsonb, p_capturado_en timestamptz
) returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora')) then
    raise exception 'No autorizado';
  end if;
  if exists (select 1 from sgc.cl_registros where id = p_id) then return p_id; end if;

  insert into sgc.cl_registros (id, proyecto_id, plantilla_id, elemento_id, vaciado_id, bloque, eje, plano_path, observaciones, creado_por)
  values (p_id, p_proyecto_id, p_plantilla_id, p_elemento_id, p_vaciado_id, p_bloque, p_eje, p_plano_path, p_observaciones, auth.uid());
  insert into sgc.cl_registro_items (registro_id, etiqueta, seccion, cumple, comentario, orden)
  select p_id, i->>'etiqueta', i->>'seccion', (i->>'cumple')::boolean, i->>'comentario', coalesce((i->>'orden')::int,0)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i;
  insert into sgc.cl_registro_fotos (registro_id, storage_path, correcto, descripcion)
  select p_id, f->>'storage_path', (f->>'correcto')::boolean, f->>'descripcion'
  from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f where nullif(f->>'storage_path','') is not null;
  insert into sgc.cl_registro_firmas (registro_id, rol, usuario_id, nombre, firma_path, metodo, orden)
  select p_id, s->>'rol', nullif(s->>'usuario_id','')::uuid, s->>'nombre', s->>'firma_path',
         coalesce(nullif(s->>'metodo',''),'pad'), coalesce((s->>'orden')::int,0)
  from jsonb_array_elements(coalesce(p_firmas,'[]'::jsonb)) s;
  return p_id;
end; $$;
grant execute on function sgc.registrar_cl_app(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,timestamptz) to authenticated, service_role;
