-- ═══════════════════════════════════════════════════════════
-- Bitácora, folded into SGC as a real module (not a separate
-- app). Field engineers get a new 'ingeniero_campo' role
-- scoped to the 'bitacora' module only.
--
-- Unlike most existing sgc tables, these get real RLS instead
-- of `using (true)` — this is the first module aimed at a
-- lower-trust, external-facing role, so it can't rely on the
-- "everyone with a login is trusted staff" assumption the rest
-- of the schema currently makes.
-- ═══════════════════════════════════════════════════════════

create table sgc.bitacoras (
  id                    uuid primary key default gen_random_uuid(),
  usuario_id            uuid not null references sgc.usuarios(id),
  proyecto_id           uuid not null references sgc.proyectos(id),
  fecha                 date not null,
  bloque_entrepiso      varchar(100) not null,
  ingeniero_responsable varchar(150) not null,
  hora_fin_trabajo      time not null,
  personal_carpinteria  smallint not null check (personal_carpinteria >= 0),
  personal_acero        smallint not null check (personal_acero >= 0),
  trabajadores_casa     smallint not null check (trabajadores_casa >= 0),
  otro_personal         text,
  comentarios           text,
  created_at            timestamptz not null default now()
);
create index idx_bitacoras_usuario on sgc.bitacoras(usuario_id);
create index idx_bitacoras_proyecto on sgc.bitacoras(proyecto_id);
create index idx_bitacoras_fecha on sgc.bitacoras(fecha);

create table sgc.bitacora_actividades (
  id           uuid primary key default gen_random_uuid(),
  bitacora_id  uuid not null references sgc.bitacoras(id) on delete cascade,
  estructura   varchar(50) not null check (estructura in
    ('COLUMNAS', 'MUROS', 'VIGAS', 'LOSAS', 'ZAPATAS/PLATEA', 'VIGAS RIOSTRAS')),
  actividad    varchar(60) not null check (actividad in
    ('TOPOGRAFIA', 'CEPOS', 'ENCOFRADO', 'ARMADO', 'LIBERACION MIVED',
     'TERMINACIONES DE ENCOFRADO/ARMADO', 'VACIADO', 'DESENCOFRADO'))
);
create index idx_bitacora_actividades on sgc.bitacora_actividades(bitacora_id);

create table sgc.bitacora_restricciones (
  id               uuid primary key default gen_random_uuid(),
  bitacora_id      uuid not null references sgc.bitacoras(id) on delete cascade,
  tipo_restriccion varchar(60) not null check (tipo_restriccion in
    ('NINGUNA', 'FALTA DE MATERIALES', 'FALTA DE EQUIPOS/HERRAMIENTAS',
     'INTERFERENCIA DE OTRAS BRIGADAS', 'FALTA DE LIBERACION PARA INICIO DE TRABAJOS',
     'FALTA DEL CLIENTE', 'CLIMA', 'OTRO')),
  descripcion_otro text
);
create index idx_bitacora_restricciones on sgc.bitacora_restricciones(bitacora_id);

create table sgc.bitacora_archivos (
  id           uuid primary key default gen_random_uuid(),
  bitacora_id  uuid not null references sgc.bitacoras(id) on delete cascade,
  nombre       varchar(255) not null,
  url          text not null,
  tipo_mime    varchar(100),
  tamano_bytes bigint,
  created_at   timestamptz not null default now()
);
create index idx_bitacora_archivos on sgc.bitacora_archivos(bitacora_id);

-- ── RLS ────────────────────────────────────────────────────
-- Visible to: the author, admins, and any staff role with access to the
-- 'proyectos' module (gerencia, gerente_proyectos) — i.e. the people who'd
-- actually use this data. A bare 'ingeniero_campo' has neither, so they
-- only ever see their own submissions.

create or replace function sgc.puede_ver_bitacora(p_bitacora_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from sgc.bitacoras b
    where b.id = p_bitacora_id
      and (
        b.usuario_id = auth.uid()
        or sgc.is_admin()
        or exists (
          select 1 from sgc.usuarios_roles ur
          join sgc.roles r on r.id = ur.rol_id
          where ur.usuario_id = auth.uid() and 'proyectos' = any(r.modulos)
        )
      )
  );
$$;

alter table sgc.bitacoras enable row level security;
create policy "bitacoras: select" on sgc.bitacoras for select to authenticated
  using (
    usuario_id = auth.uid()
    or sgc.is_admin()
    or exists (
      select 1 from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = auth.uid() and 'proyectos' = any(r.modulos)
    )
  );
create policy "bitacoras: insert" on sgc.bitacoras for insert to authenticated
  with check (usuario_id = auth.uid());
grant select, insert on sgc.bitacoras to authenticated;

alter table sgc.bitacora_actividades enable row level security;
create policy "bitacora_actividades: select" on sgc.bitacora_actividades for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id));
create policy "bitacora_actividades: insert" on sgc.bitacora_actividades for insert to authenticated
  with check (exists (select 1 from sgc.bitacoras b where b.id = bitacora_id and b.usuario_id = auth.uid()));
grant select, insert on sgc.bitacora_actividades to authenticated;

alter table sgc.bitacora_restricciones enable row level security;
create policy "bitacora_restricciones: select" on sgc.bitacora_restricciones for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id));
create policy "bitacora_restricciones: insert" on sgc.bitacora_restricciones for insert to authenticated
  with check (exists (select 1 from sgc.bitacoras b where b.id = bitacora_id and b.usuario_id = auth.uid()));
grant select, insert on sgc.bitacora_restricciones to authenticated;

alter table sgc.bitacora_archivos enable row level security;
create policy "bitacora_archivos: select" on sgc.bitacora_archivos for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id));
create policy "bitacora_archivos: insert" on sgc.bitacora_archivos for insert to authenticated
  with check (exists (select 1 from sgc.bitacoras b where b.id = bitacora_id and b.usuario_id = auth.uid()));
grant select, insert on sgc.bitacora_archivos to authenticated;

-- ── Role ─────────────────────────────────────────────────────
insert into sgc.roles (codigo, nombre, modulos)
values ('ingeniero_campo', 'Ingeniero de Campo', array['bitacora'])
on conflict (codigo) do nothing;

-- ── Storage bucket for attachments ──────────────────────────
-- Photos of site work are low-sensitivity; any authenticated user may
-- upload/read within this bucket (row-level restriction on the *data*
-- happens above, on bitacora_archivos).
insert into storage.buckets (id, name, public)
values ('sgc-bitacora', 'sgc-bitacora', false)
on conflict (id) do nothing;

create policy "sgc-bitacora: authenticated read" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-bitacora');
create policy "sgc-bitacora: authenticated upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-bitacora');
