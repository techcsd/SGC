-- ============================================================================
-- BA / FASE 6 — BA2 (flag incentivo) + BA7 (Flota Logística) + BA3 (chips Compa por rol).
-- Aditivo. Cierra hallazgos AX (población del incentivo explícita) y unifica los chips.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ===========================================================================
-- BA2 — Flag `participa_incentivo` en el conductor (población explícita).
--  Una sola fuente: rol Chofer + flag. Patchea los DOS caminos de LECTURA que
--  definen la población efectiva (pantalla+Compa vía incentivo_listado; correo
--  vía incentivo_matriz_email). La generación sigue creando filas para todo chofer
--  activo (inofensivo: no se muestran/pagan si el flag está apagado).
-- ===========================================================================
alter table sgc.conductores add column if not exists participa_incentivo boolean not null default true;
comment on column sgc.conductores.participa_incentivo is
  'BA2 — si false, el chofer NO aparece en el desempeño/incentivo (pantalla, correo, Compa). El histórico ya pagado no se altera.';

-- Los conductores de prueba salen de la población por defecto (Manolo, Papo).
update sgc.conductores set participa_incentivo = false where coalesce(es_prueba, false) and participa_incentivo;

-- Listado (pantalla Desempeño + tool de Compa desempeno_semana): + filtro flag.
create or replace function sgc.incentivo_listado(p_anio integer, p_semana integer, p_incluir_prueba boolean DEFAULT true)
 returns table(informe_id uuid, usuario_id uuid, nombre text, conductor_id uuid, puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text, motivo text, decidido_por uuid, decidido_por_nombre text, decidido_en timestamp with time zone)
 language sql stable security definer
 set search_path to 'sgc', 'public'
as $function$
  select s.id, s.usuario_id, u.nombre, s.conductor_id,
         s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags,
         v.decision, v.motivo, v.decidido_por, du.nombre, v.decidido_en
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
    left join sgc.usuarios du on du.id = v.decidido_por
   where s.anio = p_anio and s.semana = p_semana
     and sgc.puede_gestionar_incentivos()
     and exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = s.usuario_id and r.codigo = 'chofer_transportista')
     and exists (select 1 from sgc.conductores c
                 where c.usuario_id = s.usuario_id and coalesce(c.participa_incentivo, true))
     and (p_incluir_prueba
          or not exists (select 1 from sgc.conductores c
                         where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false)))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;

-- Matriz del correo semanal (AX5): + filtro flag.
create or replace function sgc.incentivo_matriz_email(p_anio integer, p_semana integer)
 returns table(nombre text, puntaje numeric, minimo numeric, cumplio boolean, conteos jsonb, flags jsonb, decision text)
 language sql stable security definer
 set search_path to 'sgc', 'public'
as $function$
  select u.nombre, s.puntaje, s.minimo, s.cumplio, s.conteos, s.flags, v.decision
    from sgc.incentivo_semana s
    join sgc.usuarios u on u.id = s.usuario_id
    left join sgc.v_incentivo_decision_vigente v on v.informe_id = s.id
   where s.anio = p_anio and s.semana = p_semana
     and exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = s.usuario_id and r.codigo = 'chofer_transportista')
     and exists (select 1 from sgc.conductores c
                 where c.usuario_id = s.usuario_id and coalesce(c.participa_incentivo, true))
     and not exists (select 1 from sgc.conductores c
                     where c.usuario_id = s.usuario_id and coalesce(c.es_prueba, false))
   order by s.cumplio desc, s.puntaje desc, u.nombre;
$function$;

-- Toggle admin (Gestión de choferes / Desempeño) — auditado en audit_log si existe.
create or replace function sgc.set_participa_incentivo(p_conductor_id uuid, p_participa boolean)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_incentivos()) then
    raise exception 'No tienes permiso para cambiar la participación en el incentivo.';
  end if;
  update sgc.conductores set participa_incentivo = coalesce(p_participa, true) where id = p_conductor_id;
end;
$$;
grant execute on function sgc.set_participa_incentivo(uuid, boolean) to authenticated;

-- ===========================================================================
-- BA7 — Logística (Raykler) con Flota completa a nivel submódulo.
--  Ya tiene Flota vía módulo + es_flota_elevado (AS5). Esto lo hace EXPLÍCITO
--  para satisfacer las policies RLS de submódulo explícito (op-upd/op-del).
--  El DELETE de vehículos sigue siendo admin-only por su policy separada.
-- ===========================================================================
update sgc.roles
   set permisos = coalesce(permisos, '{}'::jsonb) || jsonb_build_object(
         'flota.vehiculos','operar','flota.conductores','operar','flota.combustible','operar',
         'flota.mantenimientos','operar','flota.rutas','operar','flota.checklists','operar',
         'flota.avisos','operar')
 where codigo = 'logistica';

-- ===========================================================================
-- BA3 — Chips y saludo de Compa por rol (fuente única web + app + edge).
-- ===========================================================================
create table if not exists sgc.compa_chips (
  id         serial primary key,
  persona    text not null,            -- 'chofer' | 'ingeniero' | 'logistica' | 'admin' | 'default'
  texto      text not null,
  orden      int not null default 0,
  saludo     text,                      -- override opcional del saludo por persona
  subtitulo  text,                      -- override opcional del subtítulo por persona
  activo     boolean not null default true
);
create index if not exists idx_compa_chips_persona on sgc.compa_chips (persona, orden) where activo;

alter table sgc.compa_chips enable row level security;
drop policy if exists compa_chips_select on sgc.compa_chips;
create policy compa_chips_select on sgc.compa_chips for select using (true);
grant select on sgc.compa_chips to authenticated;

-- Semilla (idempotente): borra y recarga la config base por persona.
delete from sgc.compa_chips;
insert into sgc.compa_chips (persona, texto, orden, saludo, subtitulo) values
  ('chofer','¿Cuál es mi ruta de hoy?',1,'¡Hola! Soy Compa 👋','Pregúntame por tu ruta, conduces, firmas y tu puntaje de la semana.'),
  ('chofer','¿Tengo conduces pendientes?',2,null,null),
  ('chofer','¿Cómo va mi puntaje de la semana?',3,null,null),
  ('chofer','Registra una echada',4,null,null),
  ('ingeniero','¿Qué entregas tengo por confirmar?',1,'¡Hola! Soy Compa 👋','Pregúntame por tus entregas, requisiciones y tareas de obra.'),
  ('ingeniero','¿Cómo van mis requisiciones?',2,null,null),
  ('ingeniero','Crea una tarea en mi obra',3,null,null),
  ('ingeniero','¿En qué obras estoy?',4,null,null),
  ('logistica','¿Qué requisiciones hay por despachar?',1,'¡Hola! Soy Compa 👋','Pregúntame por despachos, viajes de proveedores y la flota.'),
  ('logistica','¿Cuántos viajes hizo un proveedor este mes?',2,null,null),
  ('logistica','¿Qué conduces están por firmar?',3,null,null),
  ('admin','¿Qué tareas tengo pendientes?',1,'¡Hola! Soy Compa 👋','Tu asistente de SGC — responde con datos reales, según lo que puedes ver.'),
  ('admin','¿Tengo conduces por firmar?',2,null,null),
  ('admin','¿En qué obras estoy?',3,null,null),
  ('admin','¿A qué tengo acceso en el sistema?',4,null,null),
  ('default','¿Qué tareas tengo pendientes?',1,'¡Hola! Soy Compa 👋','Pregúntame lo que necesites del sistema, con datos reales según lo que puedes ver.'),
  ('default','¿A qué tengo acceso en el sistema?',2,null,null),
  ('default','¿En qué obras estoy?',3,null,null);

-- Resuelve la persona del usuario actual y devuelve sus chips + saludo/subtítulo.
create or replace function sgc.compa_sugerencias()
returns table(texto text, saludo text, subtitulo text, persona text)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_persona text;
begin
  select case
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'chofer_transportista') then 'chofer'
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo in ('ingeniero_campo','ingeniero_oficina','jefe_ingenieros','gerente_produccion')) then 'ingeniero'
    when exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
                 where ur.usuario_id = auth.uid() and r.codigo = 'logistica') then 'logistica'
    when sgc.is_admin() then 'admin'
    else 'default' end
  into v_persona;

  return query
    select c.texto,
           first_value(c.saludo)    over (order by (c.saludo is null), c.orden) as saludo,
           first_value(c.subtitulo) over (order by (c.subtitulo is null), c.orden) as subtitulo,
           v_persona
    from sgc.compa_chips c
    where c.activo and c.persona = v_persona
    order by c.orden;
end;
$$;
grant execute on function sgc.compa_sugerencias() to authenticated, service_role;

commit;
