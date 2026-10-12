-- 2026-10-11-cm6b-incentivo-lectura-tope.sql   (CM6 — PROMPT-94 F3 / PROMPT-96 F1.1)
-- HUECO de LECTURA de "incentivos con tope": `2026-10-09-cm6-incentivo-topes.sql` añadió
-- las columnas incentivo_config.{maximo_semanal,topes} + incentivo_semana.{maximo,topes,
-- puntaje_bruto} y recreó set_config/generar_semana/sugerir_topes, PERO NO recreó los RPC
-- de LECTURA que consume la app → esos campos no llegaban al cliente (F3 del app bloqueado).
--
-- Este archivo recrea los 3 RPC de lectura con su CUERPO VIVO (verificado por objeto en
-- prod == dev, md5 idénticos) + expone los campos nuevos al final (retrocompatible):
--   • incentivo_listado        → + maximo, puntaje_bruto, topes
--   • incentivo_mi_rendimiento → + maximo (tope semanal), puntaje_bruto, topes (tope por día/sem)
--   • incentivo_semanas        → + maximo_semanal (max(maximo) del grupo = tope de la semana)
-- contados/excedente ya viajan DENTRO de `conteos[renglon]` (los añadió cm6-generar_semana),
-- así que no requieren columna nueva.
--
-- Cambia la firma de retorno → hay que DROP + CREATE (CREATE OR REPLACE no deja cambiar el
-- RETURNS TABLE). Sin dependientes en el catálogo (verificado por pg_depend). PUBLIC/postgres
-- reciben EXECUTE por defecto al crear; re-otorgamos authenticated/service_role.
--
--   node scripts/apply-migration.mjs sql/2026-10-11-cm6b-incentivo-lectura-tope.sql --env dev

begin;

-- ── 1) incentivo_listado (gestión, por chofer de una semana) ────────────────────
drop function if exists sgc.incentivo_listado(integer, integer, boolean);
create function sgc.incentivo_listado(p_anio integer, p_semana integer, p_incluir_prueba boolean default true)
returns table(
  informe_id uuid, usuario_id uuid, nombre text, conductor_id uuid, puntaje numeric,
  minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text, motivo text,
  decidido_por uuid, decidido_por_nombre text, decidido_en timestamp with time zone,
  maximo numeric, puntaje_bruto numeric, topes jsonb)
language sql stable security definer
set search_path to 'sgc', 'public'
as $function$
  select s.id, s.usuario_id, u.nombre, s.conductor_id,
         s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags,
         v.decision, v.motivo, v.decidido_por, du.nombre, v.decidido_en,
         s.maximo, s.puntaje_bruto, s.topes
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
    left join sgc.usuarios du on du.id = v.decidido_por
   where s.anio = p_anio and s.semana = p_semana
     and sgc.puede_gestionar_incentivos()
     and exists (select 1 from sgc.incentivo_participante ip
                 where ip.usuario_id = s.usuario_id and ip.es_chofer and coalesce(ip.participa, true))
     and (p_incluir_prueba
          or not exists (select 1 from sgc.conductores c
                         where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false)))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;
grant execute on function sgc.incentivo_listado(integer, integer, boolean) to authenticated, service_role;

-- ── 2) incentivo_mi_rendimiento (chofer, sus semanas) ───────────────────────────
drop function if exists sgc.incentivo_mi_rendimiento();
create function sgc.incentivo_mi_rendimiento()
returns table(
  informe_id uuid, anio integer, semana integer, inicio date, fin date, puntaje numeric,
  minimo numeric, cumplio boolean, conteos jsonb, decision text, motivo text,
  decidido_en timestamp with time zone,
  maximo numeric, puntaje_bruto numeric, topes jsonb)
language sql stable security definer
set search_path to 'sgc', 'public'
as $function$
  select s.id, s.anio, s.semana, s.inicio, s.fin,
         s.puntaje, s.minimo, s.cumplio, s.conteos,
         v.decision, v.motivo, v.decidido_en,
         s.maximo, s.puntaje_bruto, s.topes
    from sgc.incentivo_semana s
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
   where s.usuario_id = auth.uid()
   order by s.anio desc, s.semana desc;
$function$;
grant execute on function sgc.incentivo_mi_rendimiento() to authenticated, service_role;

-- ── 3) incentivo_semanas (gestión, resumen por semana) ──────────────────────────
drop function if exists sgc.incentivo_semanas();
create function sgc.incentivo_semanas()
returns table(
  anio integer, semana integer, inicio date, fin date, choferes integer, cumplieron integer,
  maximo_semanal numeric)
language sql stable security definer
set search_path to 'sgc', 'public'
as $function$
  select s.anio, s.semana, s.inicio, s.fin,
         count(*)::int, count(*) filter (where s.cumplio)::int,
         max(s.maximo)::numeric
    from sgc.incentivo_semana s
   where sgc.puede_gestionar_incentivos()
   group by s.anio, s.semana, s.inicio, s.fin
   order by s.anio desc, s.semana desc;
$function$;
grant execute on function sgc.incentivo_semanas() to authenticated, service_role;

commit;
