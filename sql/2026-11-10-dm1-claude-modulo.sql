-- ============================================================================
-- DM1 (ronda DM, PROMPT 140 F1) — Módulo Claude: biblioteca de skills por rol,
-- paquetes de arranque, progreso del Setup y encuesta de auditoría.
-- Aditivo, fechado, idempotente. No toca tablas de negocio.
--
-- Corrección verificada vs CONTEXTO (regla "gana lo verificado"): DM-03 pedía
-- submódulos "claude.administrar"/"claude.auditoria" pero el editor de permisos
-- (role-permisos-editor.ts:67) solo muestra SUBMODULOS[clave] para una clave
-- que exista en MODULOS_DISPONIBLES — y el propio DM-03 pide "sin módulo nuevo".
-- Se resuelve igual que tecnologia.wa_grupos (DL3): los submódulos cuelgan de
-- 'tecnologia' → tecnologia.claude_administrar / tecnologia.claude_auditoria.
-- ============================================================================
begin;

-- ── 1) Skills: catálogo + versiones ────────────────────────────────────────
create table if not exists sgc.claude_skills (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{1,64}$' and slug not like '%claude%' and slug not like '%anthropic%'),
  nombre         text not null,
  descripcion    text not null check (char_length(descripcion) <= 1024),
  tipo           text not null default 'skill' check (tipo in ('skill','instrucciones','plantilla','documento')),
  ambito         text not null default 'personal' check (ambito in ('personal','rol','empresa')),
  estado         text not null default 'borrador' check (estado in ('borrador','propuesta','publicada','archivada','requiere_revision')),
  roles          text[] not null default '{}',
  tags           text[] not null default '{}',
  owner_id       uuid not null references sgc.usuarios(id) on delete cascade,
  version_actual int not null default 1,
  tiene_codigo_ejecutable boolean not null default false,
  motivo_devuelta text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table sgc.claude_skills is 'DM1 — N1a: biblioteca de skills (.md/zip/prompts) que cada persona guarda, descarga o propone por rol/empresa.';
comment on column sgc.claude_skills.tiene_codigo_ejecutable is 'DM-06 — si trae .py/.sh/.js/.ts queda en requiere_revision y no puede publicarse a rol/empresa sin aprobación.';
create index if not exists idx_claude_skills_estado on sgc.claude_skills(estado);
create index if not exists idx_claude_skills_owner on sgc.claude_skills(owner_id);

create table if not exists sgc.claude_skill_versiones (
  id            uuid primary key default gen_random_uuid(),
  skill_id      uuid not null references sgc.claude_skills(id) on delete cascade,
  version       int not null,
  storage_path  text not null,
  tamano_bytes  int not null,
  sha256        text not null,
  notas         text,
  creado_por    uuid references sgc.usuarios(id),
  creado_en     timestamptz not null default now(),
  unique (skill_id, version)
);
comment on table sgc.claude_skill_versiones is 'DM1/DM-07 — cada cambio de una skill crea versión nueva; se puede volver a una anterior.';

alter table sgc.claude_skills enable row level security;
alter table sgc.claude_skill_versiones enable row level security;

-- Ver: lo mío + lo publicado para mi rol/empresa + lo que administra Tecnología.
drop policy if exists "claude_skills: ver" on sgc.claude_skills;
create policy "claude_skills: ver" on sgc.claude_skills for select to authenticated
  using (
    owner_id = auth.uid()
    or sgc.puede_ver_submodulo('tecnologia.claude_administrar')
    or (estado = 'publicada' and (
          ambito = 'empresa'
          or (ambito = 'rol' and exists (
                select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                where ur.usuario_id = auth.uid() and r.codigo = any(sgc.claude_skills.roles)))
        ))
  );
drop policy if exists "claude_skills: crear propia" on sgc.claude_skills;
create policy "claude_skills: crear propia" on sgc.claude_skills for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "claude_skills: editar lo mío" on sgc.claude_skills;
create policy "claude_skills: editar lo mío" on sgc.claude_skills for update to authenticated
  using (owner_id = auth.uid() or sgc.puede_operar_submodulo('tecnologia.claude_administrar'))
  with check (owner_id = auth.uid() or sgc.puede_operar_submodulo('tecnologia.claude_administrar'));
grant select, insert, update on sgc.claude_skills to authenticated;
grant all on sgc.claude_skills to service_role;

drop policy if exists "claude_skill_versiones: ver" on sgc.claude_skill_versiones;
create policy "claude_skill_versiones: ver" on sgc.claude_skill_versiones for select to authenticated
  using (exists (select 1 from sgc.claude_skills s where s.id = skill_id));
grant select on sgc.claude_skill_versiones to authenticated;
grant all on sgc.claude_skill_versiones to service_role;

-- ── 2) Paquetes (packs) ─────────────────────────────────────────────────────
create table if not exists sgc.claude_packs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  nombre      text not null,
  descripcion text,
  tipo        text not null default 'personalizado' check (tipo in ('setup','rol','personalizado')),
  rol         text,
  created_at  timestamptz not null default now()
);
comment on table sgc.claude_packs is 'DM1/DM-12 — paquetes descargables: "Setup inicial" (para todos) + uno por rol (autogenerado) + personalizados.';

create table if not exists sgc.claude_pack_items (
  id         uuid primary key default gen_random_uuid(),
  pack_id    uuid not null references sgc.claude_packs(id) on delete cascade,
  skill_id   uuid references sgc.claude_skills(id) on delete cascade,
  tipo_item  text not null default 'skill' check (tipo_item in ('skill','leeme','guia')),
  titulo     text,
  contenido  text,
  orden      int not null default 0
);
comment on table sgc.claude_pack_items is 'DM1/DM-12 — contenido de un pack: skills enlazadas + texto libre (LEEME, hoja de buenas prácticas).';

alter table sgc.claude_packs enable row level security;
alter table sgc.claude_pack_items enable row level security;
drop policy if exists "claude_packs: ver todos" on sgc.claude_packs;
create policy "claude_packs: ver todos" on sgc.claude_packs for select to authenticated using (true);
drop policy if exists "claude_pack_items: ver todos" on sgc.claude_pack_items;
create policy "claude_pack_items: ver todos" on sgc.claude_pack_items for select to authenticated using (true);
grant select on sgc.claude_packs, sgc.claude_pack_items to authenticated;
grant all on sgc.claude_packs, sgc.claude_pack_items to service_role;

-- ── 3) Progreso del Setup, por persona (DM-13) ─────────────────────────────
create table if not exists sgc.claude_progreso (
  usuario_id          uuid primary key references sgc.usuarios(id) on delete cascade,
  conecto_sgc         boolean not null default false,
  descargo_setup      boolean not null default false,
  subio_primera_skill boolean not null default false,
  probo_pregunta      boolean not null default false,
  updated_at          timestamptz not null default now()
);
alter table sgc.claude_progreso enable row level security;
drop policy if exists "claude_progreso: lo mío" on sgc.claude_progreso;
create policy "claude_progreso: lo mío" on sgc.claude_progreso for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update on sgc.claude_progreso to authenticated;
grant all on sgc.claude_progreso to service_role;

create or replace function sgc.claude_progreso_marcar(p_campo text, p_valor boolean default true)
returns sgc.claude_progreso
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row sgc.claude_progreso;
begin
  if p_campo not in ('conecto_sgc','descargo_setup','subio_primera_skill','probo_pregunta') then
    raise exception 'Campo inválido.' using errcode = '22023';
  end if;
  insert into sgc.claude_progreso (usuario_id) values (auth.uid()) on conflict (usuario_id) do nothing;
  execute format('update sgc.claude_progreso set %I = $1, updated_at = now() where usuario_id = $2', p_campo)
    using p_valor, auth.uid();
  select * into v_row from sgc.claude_progreso where usuario_id = auth.uid();
  return v_row;
end;
$function$;
grant execute on function sgc.claude_progreso_marcar(text, boolean) to authenticated;

-- ── 4) Encuesta de auditoría (DM-17) — una respuesta por persona, editable ──
create table if not exists sgc.claude_encuesta_respuestas (
  usuario_id          uuid primary key references sgc.usuarios(id) on delete cascade,
  rol_snapshot        text,
  usa_hoy             text,
  tareas              text,
  tarea_repetida      text,
  que_frena           text,
  documento_semanal   text,
  que_deberia_hacer   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table sgc.claude_encuesta_respuestas is 'DM1/DM-17 — encuesta corta (≤3 min) de la auditoría N1c. Una respuesta por persona, editable.';
alter table sgc.claude_encuesta_respuestas enable row level security;
drop policy if exists "claude_encuesta: responder lo mío" on sgc.claude_encuesta_respuestas;
create policy "claude_encuesta: responder lo mío" on sgc.claude_encuesta_respuestas for all to authenticated
  using (usuario_id = auth.uid() or sgc.puede_ver_submodulo('tecnologia.claude_auditoria'))
  with check (usuario_id = auth.uid());
grant select, insert, update on sgc.claude_encuesta_respuestas to authenticated;
grant all on sgc.claude_encuesta_respuestas to service_role;

create or replace function sgc.claude_encuesta_guardar(
  p_usa_hoy text, p_tareas text, p_tarea_repetida text, p_que_frena text,
  p_documento_semanal text, p_que_deberia_hacer text
) returns sgc.claude_encuesta_respuestas
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_rol text;
  v_row sgc.claude_encuesta_respuestas;
begin
  select string_agg(r.codigo, ',') into v_rol
    from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id where ur.usuario_id = auth.uid();
  insert into sgc.claude_encuesta_respuestas
    (usuario_id, rol_snapshot, usa_hoy, tareas, tarea_repetida, que_frena, documento_semanal, que_deberia_hacer, updated_at)
  values (auth.uid(), v_rol, p_usa_hoy, p_tareas, p_tarea_repetida, p_que_frena, p_documento_semanal, p_que_deberia_hacer, now())
  on conflict (usuario_id) do update set
    rol_snapshot = excluded.rol_snapshot, usa_hoy = excluded.usa_hoy, tareas = excluded.tareas,
    tarea_repetida = excluded.tarea_repetida, que_frena = excluded.que_frena,
    documento_semanal = excluded.documento_semanal, que_deberia_hacer = excluded.que_deberia_hacer,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$function$;
grant execute on function sgc.claude_encuesta_guardar(text, text, text, text, text, text) to authenticated;

-- Resultados agregados por rol — solo claude_auditoria.
create or replace function sgc.claude_encuesta_resultados()
returns table(rol_snapshot text, respuestas bigint)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select rol_snapshot, count(*) from sgc.claude_encuesta_respuestas
   where sgc.puede_ver_submodulo('tecnologia.claude_auditoria')
   group by rol_snapshot order by 2 desc;
$function$;
grant execute on function sgc.claude_encuesta_resultados() to authenticated;

-- ── 5) Organización de Claude (DM-15/18) — sección editable, sin automatizar nada ──
create table if not exists sgc.claude_org_info (
  id               int primary key default 1 check (id = 1),
  plan             text,
  asientos_totales int,
  asientos_ocupados int,
  owners           text[] not null default '{}',
  conectores       text[] not null default '{}',
  skills_organizacion jsonb not null default '[]'::jsonb,
  notas            text,
  actualizado_por  uuid references sgc.usuarios(id),
  actualizado_en   timestamptz not null default now()
);
comment on table sgc.claude_org_info is 'DM1/DM-15/18 — "Cómo está configurada nuestra organización" (asientos/conectores/skills), llenada a mano por Tecnología. No automatiza nada contra la consola de Claude.';
insert into sgc.claude_org_info (id) values (1) on conflict (id) do nothing;

alter table sgc.claude_org_info enable row level security;
drop policy if exists "claude_org_info: ver" on sgc.claude_org_info;
create policy "claude_org_info: ver" on sgc.claude_org_info for select to authenticated using (true);
drop policy if exists "claude_org_info: editar" on sgc.claude_org_info;
create policy "claude_org_info: editar" on sgc.claude_org_info for update to authenticated
  using (sgc.puede_operar_submodulo('tecnologia.claude_administrar'))
  with check (sgc.puede_operar_submodulo('tecnologia.claude_administrar'));
grant select, update on sgc.claude_org_info to authenticated;
grant all on sgc.claude_org_info to service_role;

-- ── 6) Ciclo de vida de una skill (DM-07) ───────────────────────────────────
create or replace function sgc.claude_skill_proponer(p_skill_id uuid, p_ambito text)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_owner uuid; v_estado text; v_codigo boolean;
begin
  select owner_id, estado, tiene_codigo_ejecutable into v_owner, v_estado, v_codigo
    from sgc.claude_skills where id = p_skill_id;
  if v_owner is null then raise exception 'Skill no encontrada.' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() then raise exception 'Solo el dueño puede proponerla.' using errcode = '42501'; end if;
  if p_ambito not in ('rol','empresa') then raise exception 'Ámbito inválido.' using errcode = '22023'; end if;
  update sgc.claude_skills
     set ambito = p_ambito,
         estado = case when v_codigo then 'requiere_revision' else 'propuesta' end,
         updated_at = now()
   where id = p_skill_id;
end;
$function$;
grant execute on function sgc.claude_skill_proponer(uuid, text) to authenticated;

create or replace function sgc.claude_skill_decidir(p_skill_id uuid, p_decision text, p_motivo text default null)
returns void
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.puede_operar_submodulo('tecnologia.claude_administrar') then
    raise exception 'Sin permiso para aprobar skills.' using errcode = '42501';
  end if;
  if p_decision not in ('publicada','borrador','archivada') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  update sgc.claude_skills
     set estado = p_decision,
         motivo_devuelta = case when p_decision = 'borrador' then p_motivo else null end,
         updated_at = now()
   where id = p_skill_id;
end;
$function$;
grant execute on function sgc.claude_skill_decidir(uuid, text, text) to authenticated;

-- ── 7) Bucket privado ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('claude-skills', 'claude-skills', false)
on conflict (id) do nothing;
drop policy if exists "claude-skills: owner rw" on storage.objects;
create policy "claude-skills: owner rw" on storage.objects for all to authenticated
  using (bucket_id = 'claude-skills' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'claude-skills' and (storage.foldername(name))[1] = auth.uid()::text);
grant all on storage.objects to service_role;

-- ── 8) Siembra: 6 skills de arranque (DM-10) — publicadas, empresa, sin código ──
insert into sgc.claude_skills (slug, nombre, descripcion, tipo, ambito, estado, roles, owner_id, tiene_codigo_ejecutable)
select v.slug, v.nombre, v.descripcion, 'skill', 'empresa', 'publicada', '{}', (select id from sgc.usuarios where nombre = 'Xaviel Terrero'), false
from (values
  ('pedir-bien-a-la-ia', 'Cómo pedir bien algo a Claude', 'Guía para redactar buenas peticiones a la IA en español, con ejemplos de obra y oficina. Úsala cuando la persona no sepa cómo pedir algo o el resultado salga genérico.'),
  ('resumir-documento', 'Resumir un documento o acta', 'Resume un documento, acta o informe en español con puntos clave, decisiones y pendientes. Úsala cuando la persona pegue o adjunte un texto largo.'),
  ('redactar-oficio-formal', 'Redactar correo/oficio formal', 'Redacta correos u oficios formales en español dominicano de oficina para proveedores, clientes o entidades. Úsala al pedir una carta, oficio o correo formal.'),
  ('notas-a-acta', 'Convertir notas sueltas en acta', 'Convierte notas sueltas de una reunión en un acta con asistentes, acuerdos y responsables. Úsala después de una reunión o llamada.'),
  ('revisar-cotizacion', 'Revisar una cotización o presupuesto', 'Compara una cotización o presupuesto contra lo pedido y señala diferencias de cantidad, unidad, precio y condiciones. Úsala al recibir una cotización de proveedor.'),
  ('usar-el-sgc-desde-ia', 'Usar el SGC desde Claude', 'Cómo hacer preguntas útiles al SGC desde la IA y qué esperar de las herramientas del conector. Úsala cuando la persona pregunte por datos del SGC.')
) as v(slug, nombre, descripcion)
on conflict (slug) do nothing;

-- Pack "Setup inicial" con las 6 skills de arranque.
insert into sgc.claude_packs (slug, nombre, descripcion, tipo) values
  ('setup-inicial', 'Setup inicial', 'Paquete de arranque para cualquier persona nueva o principiante: 6 atajos listos + guía de conexión + buenas prácticas de datos.', 'setup')
on conflict (slug) do nothing;

-- Idempotente por borrado-y-siembra (claude_pack_items no tiene una clave
-- natural única limpia entre ítems de texto y de skill): se reconstruye el
-- contenido del pack Setup inicial completo en cada corrida de esta migración.
delete from sgc.claude_pack_items where pack_id = (select id from sgc.claude_packs where slug = 'setup-inicial');

insert into sgc.claude_pack_items (pack_id, tipo_item, titulo, contenido, orden)
select (select id from sgc.claude_packs where slug = 'setup-inicial'), 'leeme', 'LEEME-INSTALAR',
  'Bienvenido a Claude en Constructora SD. 1) Conecta el SGC a Claude (Mi conexión). 2) Sube cada skill de este pack a Claude (Configuración de organización → Skills, o tu cuenta personal). 3) Prueba una pregunta real de tu trabajo. 4) Guarda tu primer atajo cuando repitas una tarea 3 veces.',
  0;
insert into sgc.claude_pack_items (pack_id, tipo_item, titulo, contenido, orden)
select (select id from sgc.claude_packs where slug = 'setup-inicial'), 'guia', 'Regla de oro de datos',
  'NO pegues en Claude cédulas, claves, contraseñas, datos de nómina ni contratos completos de terceros. Claude solo ve lo que tu usuario ya ve en el SGC. Si dudas, pregunta a Tecnología.',
  1;
insert into sgc.claude_pack_items (pack_id, skill_id, tipo_item, orden)
select (select id from sgc.claude_packs where slug = 'setup-inicial'), s.id, 'skill', 2 + row_number() over (order by s.slug)
from sgc.claude_skills s where s.slug in ('pedir-bien-a-la-ia','resumir-documento','redactar-oficio-formal','notas-a-acta','revisar-cotizacion','usar-el-sgc-desde-ia');

commit;
