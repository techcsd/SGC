-- =============================================================================
-- AR1 — Registro de Personal de obra (submódulo de Proyectos)
--
-- Entidad NUEVA (no extiende empleados de RRHH: éste es personal de obra —
-- incluye jornaleros haitianos/dominicanos sin nómina, con pasaporte, etc.).
-- Modelo: catálogo de CARGOS con ID único + persona (datos + nacionalidad +
-- documento cédula|pasaporte) ligada a una obra, 5 fotos tipadas de evidencia,
-- documento(s) firmado(s) y carnet emitido (número + QR → expediente).
-- Reutiliza el patrón obra-scoped de cronograma para la RLS ("su obra").
--
-- Gating: submódulo 'proyectos.personal'. Elevados (admin/proyectos/rrhh/
-- direccion) ven y editan todo; ingenieros/capataces (responsable_id /
-- proyecto_responsables / proyecto_empleados) registran y ven SU obra.
-- =============================================================================

begin;

-- ── 1) Catálogo de CARGOS (cada cargo con ID único: uuid + código estable) ────
create table if not exists sgc.cargos (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,          -- ID único legible p/ el carnet: VAR, CARP, CAP…
  nombre      text not null,                 -- "Varillero"
  descripcion text,
  categoria   text,                          -- casa | obrero | supervision | especializado (libre)
  activo      boolean not null default true,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);
comment on table sgc.cargos is 'AR1 — catálogo administrable de cargos de obra. `codigo` = ID único del cargo (se imprime en el carnet).';

-- Seed inicial (los cargos mencionados + los comunes). Idempotente por código.
insert into sgc.cargos (codigo, nombre, categoria, orden) values
  ('CASA', 'Personal de la casa', 'casa', 10),
  ('CAP',  'Capataz',             'supervision', 20),
  ('MAE',  'Maestro',             'supervision', 30),
  ('VAR',  'Varillero',           'obrero', 40),
  ('FERR', 'Ferrallero (acero)',  'obrero', 50),
  ('CARP', 'Carpintero',          'obrero', 60),
  ('ALB',  'Albañil',             'obrero', 70),
  ('AYU',  'Ayudante',            'obrero', 80),
  ('PLOM', 'Plomero',             'especializado', 90),
  ('ELEC', 'Electricista',        'especializado', 100),
  ('PINT', 'Pintor',              'especializado', 110),
  ('SOLD', 'Soldador',            'especializado', 120),
  ('OPER', 'Operador de equipo',  'especializado', 130),
  ('VIG',  'Vigilante',           'obrero', 140)
on conflict (codigo) do nothing;

-- ── 2) PERSONAL de obra ──────────────────────────────────────────────────────
create sequence if not exists sgc.personal_carnet_seq;

create table if not exists sgc.personal_obra (
  id                uuid primary key default gen_random_uuid(),
  proyecto_id       uuid not null references sgc.proyectos(id),
  nombre            text not null,
  apellido          text,
  nacionalidad      text not null default 'dominicano',   -- dominicano | haitiano | otro (abierto)
  tipo_documento    text not null default 'cedula',        -- cedula | pasaporte | carnet_electoral | ninguno
  documento_numero  text,                                  -- sin validación DR-only
  cargo_id          uuid references sgc.cargos(id),
  empleado_id       uuid references sgc.empleados(id),      -- puente opcional si es personal de la casa
  telefono          text,
  notas             text,
  -- carnet emitido
  carnet_numero     text unique,
  carnet_emitido_at timestamptz,
  carnet_emitido_por uuid references sgc.usuarios(id),
  estado            text not null default 'activo',          -- activo | inactivo
  es_prueba         boolean not null default false,
  registrado_por    uuid references sgc.usuarios(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_personal_obra_proyecto on sgc.personal_obra(proyecto_id);
create index if not exists idx_personal_obra_cargo    on sgc.personal_obra(cargo_id);
comment on table sgc.personal_obra is 'AR1 — personal registrado en obra (obreros/jornaleros + personal de la casa) con expediente fotográfico y carnet.';

-- Hereda es_prueba de la obra (aislamiento de datos de prueba).
create or replace function sgc.tg_personal_obra_es_prueba()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if new.es_prueba is not true then
    new.es_prueba := coalesce((select p.es_prueba from sgc.proyectos p where p.id = new.proyecto_id), false);
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists trg_personal_obra_es_prueba on sgc.personal_obra;
create trigger trg_personal_obra_es_prueba
  before insert or update on sgc.personal_obra
  for each row execute function sgc.tg_personal_obra_es_prueba();

-- ── 3) 5 FOTOS tipadas de evidencia ──────────────────────────────────────────
create table if not exists sgc.personal_obra_fotos (
  id          uuid primary key default gen_random_uuid(),
  personal_id uuid not null references sgc.personal_obra(id) on delete cascade,
  tipo        text not null check (tipo in ('persona','documento','pared','carnet','persona_carnet_cedula')),
  foto_path   text not null,
  subido_por  uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now(),
  unique (personal_id, tipo)
);
comment on table sgc.personal_obra_fotos is 'AR1 — evidencia fotográfica: persona, documento, foto pegada a la pared, carnet, persona con carnet+cédula.';

-- ── 4) DOCUMENTOS firmados (paso de firma, plantillas de Legal) ───────────────
create table if not exists sgc.personal_obra_firmas (
  id               uuid primary key default gen_random_uuid(),
  personal_id      uuid not null references sgc.personal_obra(id) on delete cascade,
  plantilla_id     uuid,                       -- plantilla de Legal usada (si aplica)
  documento_nombre text not null,              -- "Acuerdo de trabajo en obra", etc.
  firma_path       text not null,              -- PNG del pad de firma (bucket personal-obra)
  documento_path   text,                       -- PDF del documento firmado (opcional)
  metodo           text not null default 'pad' check (metodo in ('pad','foto')),
  firmado_at       timestamptz not null default now(),
  registrado_por   uuid references sgc.usuarios(id)
);
comment on table sgc.personal_obra_firmas is 'AR1 — documentos firmados por el personal al registrarse (pad AC7 + plantillas de Legal).';

-- ── 5) Bucket privado para evidencia + firmas ────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personal-obra', 'personal-obra', false, 15728640,
        array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

-- ── 6) Helpers de permiso obra-scoped (patrón cronograma) ────────────────────
create or replace function sgc.puede_ver_personal_obra(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh') or sgc.tiene_modulo('direccion')
      or sgc.puede_ver_submodulo('proyectos.personal')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables pr where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo)
      or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
                  where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid());
$$;
grant execute on function sgc.puede_ver_personal_obra(uuid) to authenticated;

create or replace function sgc.puede_gestionar_personal_obra(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh') or sgc.tiene_modulo('direccion')
      or sgc.puede_operar_submodulo('proyectos.personal')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables pr where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo)
      or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
                  where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid());
$$;
grant execute on function sgc.puede_gestionar_personal_obra(uuid) to authenticated;

-- ── 7) RLS ───────────────────────────────────────────────────────────────────
alter table sgc.cargos                enable row level security;
alter table sgc.personal_obra         enable row level security;
alter table sgc.personal_obra_fotos   enable row level security;
alter table sgc.personal_obra_firmas  enable row level security;

-- cargos: lectura para cualquier autenticado (referencia, AN3); escritura elevada.
drop policy if exists "cargos: lectura" on sgc.cargos;
create policy "cargos: lectura" on sgc.cargos for select to authenticated using (true);
drop policy if exists "cargos: escritura" on sgc.cargos;
create policy "cargos: escritura" on sgc.cargos for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh'));

-- personal_obra: por obra.
drop policy if exists "personal_obra: ver" on sgc.personal_obra;
create policy "personal_obra: ver" on sgc.personal_obra for select to authenticated
  using (sgc.puede_ver_personal_obra(proyecto_id));
drop policy if exists "personal_obra: insertar" on sgc.personal_obra;
create policy "personal_obra: insertar" on sgc.personal_obra for insert to authenticated
  with check (sgc.puede_gestionar_personal_obra(proyecto_id));
drop policy if exists "personal_obra: actualizar" on sgc.personal_obra;
create policy "personal_obra: actualizar" on sgc.personal_obra for update to authenticated
  using (sgc.puede_gestionar_personal_obra(proyecto_id))
  with check (sgc.puede_gestionar_personal_obra(proyecto_id));

-- fotos / firmas: heredan permiso del personal (vía su obra).
drop policy if exists "personal_fotos: ver" on sgc.personal_obra_fotos;
create policy "personal_fotos: ver" on sgc.personal_obra_fotos for select to authenticated
  using (exists (select 1 from sgc.personal_obra po where po.id = personal_id and sgc.puede_ver_personal_obra(po.proyecto_id)));
drop policy if exists "personal_fotos: gestionar" on sgc.personal_obra_fotos;
create policy "personal_fotos: gestionar" on sgc.personal_obra_fotos for all to authenticated
  using (exists (select 1 from sgc.personal_obra po where po.id = personal_id and sgc.puede_gestionar_personal_obra(po.proyecto_id)))
  with check (exists (select 1 from sgc.personal_obra po where po.id = personal_id and sgc.puede_gestionar_personal_obra(po.proyecto_id)));

drop policy if exists "personal_firmas: ver" on sgc.personal_obra_firmas;
create policy "personal_firmas: ver" on sgc.personal_obra_firmas for select to authenticated
  using (exists (select 1 from sgc.personal_obra po where po.id = personal_id and sgc.puede_ver_personal_obra(po.proyecto_id)));
drop policy if exists "personal_firmas: gestionar" on sgc.personal_obra_firmas;
create policy "personal_firmas: gestionar" on sgc.personal_obra_firmas for all to authenticated
  using (exists (select 1 from sgc.personal_obra po where po.id = personal_id and sgc.puede_gestionar_personal_obra(po.proyecto_id)))
  with check (exists (select 1 from sgc.personal_obra po where po.id = personal_id and sgc.puede_gestionar_personal_obra(po.proyecto_id)));

-- Storage policies del bucket (autenticado con capacidad de personal).
drop policy if exists "personal-obra: leer" on storage.objects;
create policy "personal-obra: leer" on storage.objects for select to authenticated
  using (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_ver_submodulo('proyectos.personal')));
drop policy if exists "personal-obra: subir" on storage.objects;
create policy "personal-obra: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_operar_submodulo('proyectos.personal')));
drop policy if exists "personal-obra: borrar" on storage.objects;
create policy "personal-obra: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'personal-obra' and (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or sgc.tiene_modulo('direccion') or sgc.puede_operar_submodulo('proyectos.personal')));

grant select, insert, update on sgc.cargos to authenticated;
grant select, insert, update, delete on sgc.personal_obra to authenticated;
grant select, insert, update, delete on sgc.personal_obra_fotos to authenticated;
grant select, insert, update, delete on sgc.personal_obra_firmas to authenticated;
grant usage on sequence sgc.personal_carnet_seq to authenticated;

-- ── 7.5) RPCs con lógica de servidor (carnet + conteos) ──────────────────────

-- Emite (o reemite) el carnet: asigna número único CSD-###### de forma atómica.
create or replace function sgc.emitir_carnet_personal(p_id uuid)
returns text language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare
  v_proyecto uuid;
  v_num text;
begin
  select proyecto_id, carnet_numero into v_proyecto, v_num from sgc.personal_obra where id = p_id;
  if v_proyecto is null then raise exception 'Personal no encontrado' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_personal_obra(v_proyecto) then
    raise exception 'Sin permiso para emitir el carnet' using errcode = '42501';
  end if;
  if v_num is null then
    v_num := 'CSD-' || to_char(nextval('sgc.personal_carnet_seq'), 'FM000000');
  end if;
  update sgc.personal_obra
     set carnet_numero = v_num,
         carnet_emitido_at = coalesce(carnet_emitido_at, now()),
         carnet_emitido_por = auth.uid(),
         updated_at = now()
   where id = p_id;
  return v_num;
end; $$;
grant execute on function sgc.emitir_carnet_personal(uuid) to authenticated;

-- Conteos por obra: total, por cargo y por nacionalidad (para la vista del proyecto).
create or replace function sgc.personal_obra_conteos(p_proyecto_id uuid)
returns jsonb language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select case when not sgc.puede_ver_personal_obra(p_proyecto_id) then '{}'::jsonb else jsonb_build_object(
    'total', (select count(*) from sgc.personal_obra po
               where po.proyecto_id = p_proyecto_id and po.estado = 'activo'
                 and coalesce(po.es_prueba,false) = false),
    'por_cargo', (select coalesce(jsonb_agg(jsonb_build_object('cargo', nombre, 'codigo', codigo, 'total', n) order by n desc), '[]'::jsonb)
                   from (select coalesce(c.nombre,'(sin cargo)') nombre, c.codigo, count(*) n
                           from sgc.personal_obra po left join sgc.cargos c on c.id = po.cargo_id
                          where po.proyecto_id = p_proyecto_id and po.estado = 'activo' and coalesce(po.es_prueba,false) = false
                          group by c.nombre, c.codigo) t),
    'por_nacionalidad', (select coalesce(jsonb_agg(jsonb_build_object('nacionalidad', nacionalidad, 'total', n) order by n desc), '[]'::jsonb)
                   from (select nacionalidad, count(*) n
                           from sgc.personal_obra po
                          where po.proyecto_id = p_proyecto_id and po.estado = 'activo' and coalesce(po.es_prueba,false) = false
                          group by nacionalidad) t)
  ) end;
$$;
grant execute on function sgc.personal_obra_conteos(uuid) to authenticated, service_role;

-- ── 8) Registrar el submódulo en el rol admin ────────────────────────────────
update sgc.roles
   set modulos = case when 'proyectos' = any(modulos) then modulos else array_append(modulos, 'proyectos') end,
       permisos = coalesce(permisos, '{}'::jsonb) || jsonb_build_object('proyectos.personal', 'operar')
 where codigo = 'admin';

commit;
