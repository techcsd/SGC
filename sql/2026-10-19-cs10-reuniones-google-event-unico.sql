-- ============================================================================
-- CS10 — "Llevar al SGC" debe ser idempotente (dos clics = una sola reunión).
-- Regla 19: sgc.reuniones.google_event_id ya existe (CP8,
-- sql/2026-10-16-cp8-reuniones.sql) pero sin índice único — lo agrego aditivo.
-- Parcial (where not null): varias reuniones creadas DESDE el SGC sin Google
-- event (NULL) no deben chocar entre sí.
-- ============================================================================

begin;

create unique index if not exists idx_reuniones_google_event_id_unico
  on sgc.reuniones (google_event_id)
  where google_event_id is not null;

-- ── reuniones_listado +google_event_id (para que «EN EL SGC» del chip de
-- Google pueda comparar sin una consulta aparte) — MISMO cuerpo verificado en
-- vivo (regla 19), solo se agrega la columna al final de RETURNS TABLE/SELECT. ──
drop function if exists sgc.reuniones_listado(text, uuid, uuid);
create function sgc.reuniones_listado(p_filtro text DEFAULT 'proximas'::text, p_tipo_id uuid DEFAULT NULL::uuid, p_proyecto_id uuid DEFAULT NULL::uuid)
 returns table(id uuid, tipo_codigo text, tipo_nombre text, tipo_color text, titulo text, inicio timestamp with time zone, fin timestamp with time zone, modalidad text, lugar text, enlace text, proyecto_id uuid, proyecto_nombre text, organizador_id uuid, organizador_nombre text, estado text, fireflies_id text, participantes_n bigint, acuerdos_n bigint, acta_lista boolean, google_event_id text)
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select r.id, rt.codigo, rt.nombre, rt.color, r.titulo, r.inicio, r.fin, r.modalidad, r.lugar, r.enlace,
         r.proyecto_id, p.nombre::text, r.organizador_id, u.nombre::text, r.estado, r.fireflies_id,
         (select count(*) from sgc.reunion_participantes rp where rp.reunion_id = r.id),
         (select count(*) from sgc.reunion_acuerdos ra where ra.reunion_id = r.id),
         exists (select 1 from sgc.reunion_actas ac where ac.reunion_id = r.id and ac.resumen is not null),
         r.google_event_id
    from sgc.reuniones r
    join sgc.reunion_tipos rt on rt.id = r.tipo_id
    left join sgc.proyectos p on p.id = r.proyecto_id
    join sgc.usuarios u on u.id = r.organizador_id
   where sgc.puede_ver_reunion(r.id)
     and (p_tipo_id is null or r.tipo_id = p_tipo_id)
     and (p_proyecto_id is null or r.proyecto_id = p_proyecto_id)
     and (
       (p_filtro = 'proximas' and r.fin >= now() and r.estado <> 'cancelada')
       or (p_filtro = 'acta_pendiente' and r.estado in ('en_curso','acta_borrador') and r.fin < now() + interval '1 hour')
       or (p_filtro = 'pasadas' and r.fin < now())
       or (p_filtro = 'mias' and (r.organizador_id = auth.uid()
             or exists (select 1 from sgc.reunion_participantes rp where rp.reunion_id = r.id and rp.usuario_id = auth.uid())))
       or (p_filtro is null)
     )
   order by (case when p_filtro = 'pasadas' then r.inicio end) desc,
            (case when p_filtro <> 'pasadas' then r.inicio end) asc
   limit 200;
$function$;
grant execute on function sgc.reuniones_listado(text, uuid, uuid) to authenticated;

commit;
