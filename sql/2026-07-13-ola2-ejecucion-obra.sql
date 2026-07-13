-- ============================================================================
-- Ola 2 — Registros de ejecución de obra (CSD-OPE-01 §8.2/§9). Base de datos:
-- CL-01..07 (liberación con ciclo de firmas), registro de vaciado, NC (regla
-- "NC abierta bloquea vaciado"), informe semanal, reporte de pérdidas/daños,
-- charlas de seguridad. Aditivo. RLS: proyectos/bitacora/admin (obra captura).
-- ============================================================================
set search_path = sgc, public;

-- ── Plantillas de checklist de liberación CL-01..07 ──
create table if not exists sgc.cl_plantillas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null, nombre text not null, fase text, descripcion text,
  orden int not null default 0, activo boolean not null default true
);
create table if not exists sgc.cl_plantilla_items (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references sgc.cl_plantillas(id) on delete cascade,
  seccion text, etiqueta text not null, orden int not null default 0
);

-- ── Registro de liberación (un CL llenado) + firmas (ciclo) + fotos ──
create table if not exists sgc.cl_registros (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  plantilla_id uuid references sgc.cl_plantillas(id),
  elemento_id uuid references sgc.obra_elementos(id) on delete set null,
  vaciado_id uuid references sgc.obra_vaciados(id) on delete set null,
  bloque text, eje text, plano_path text,
  estado text not null default 'borrador',  -- borrador | firmado
  observaciones text, creado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists sgc.cl_registro_items (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references sgc.cl_registros(id) on delete cascade,
  etiqueta text not null, seccion text, cumple boolean, comentario text, orden int not null default 0
);
-- Ciclo de firmas Maestro → Residente → Responsable → Cliente/MIVHED
create table if not exists sgc.cl_registro_firmas (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references sgc.cl_registros(id) on delete cascade,
  rol text not null,  -- maestro | residente | responsable | cliente | mivhed
  usuario_id uuid references sgc.usuarios(id), nombre text,
  firma_path text, firmado_en timestamptz not null default now(), orden int not null default 0
);
create table if not exists sgc.cl_registro_fotos (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references sgc.cl_registros(id) on delete cascade,
  storage_path text not null, correcto boolean, descripcion text
);

-- ── Informe semanal / Reporte de pérdidas o daños / Charlas de seguridad ──
create table if not exists sgc.informes_semanales (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  fecha date not null default current_date, contenido text, avance_pct numeric,
  creado_por uuid references sgc.usuarios(id), created_at timestamptz not null default now()
);
create table if not exists sgc.reportes_perdidas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references sgc.proyectos(id) on delete cascade,
  bodega_id uuid references sgc.bodegas(id),
  tipo text, descripcion text not null, fecha date not null default current_date,
  fotos text[] not null default '{}', reportado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now()
);
create table if not exists sgc.charlas_seguridad (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  fecha date not null default current_date, tema text, notas text,
  asistentes int, fotos text[] not null default '{}', firmas text[] not null default '{}',
  creado_por uuid references sgc.usuarios(id), created_at timestamptz not null default now()
);

-- ── Regla de oro: una NC abierta que bloquea impide marcar el vaciado ──
create or replace function sgc.trg_nc_bloquea_vaciado() returns trigger language plpgsql
set search_path to 'sgc','pg_temp' as $$
begin
  if NEW.estado in ('liberado','vaciado') and (OLD.estado is distinct from NEW.estado) then
    if exists (
      select 1 from sgc.obra_no_conformidades nc
      where nc.estado = 'abierta' and nc.bloquea_vaciado
        and (nc.vaciado_id = NEW.id
             or (nc.vaciado_id is null and nc.elemento_id is not distinct from NEW.elemento_id and nc.proyecto_id = NEW.proyecto_id))
    ) then
      raise exception 'No se puede % el vaciado: hay una No Conformidad abierta que lo bloquea.', NEW.estado;
    end if;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_vaciado_nc on sgc.obra_vaciados;
create trigger trg_vaciado_nc before update on sgc.obra_vaciados
  for each row execute function sgc.trg_nc_bloquea_vaciado();

-- ── RLS + grants (obra: proyectos/bitacora/admin) ──
do $$
declare t text;
begin
  foreach t in array array['cl_plantillas','cl_plantilla_items','cl_registros','cl_registro_items',
                           'cl_registro_firmas','cl_registro_fotos','informes_semanales',
                           'reportes_perdidas','charlas_seguridad']
  loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists %I_all on sgc.%I', t, t);
    execute format($p$create policy %I_all on sgc.%I for all to authenticated
       using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'))
       with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'))$p$, t, t);
    execute format('grant select, insert, update, delete on sgc.%I to authenticated', t);
    execute format('grant all on sgc.%I to service_role', t);
  end loop;
end $$;

-- ── Seed CL-01..07 (encabezados; los ítems finos se afinan luego) ──
insert into sgc.cl_plantillas (codigo, nombre, fase, orden) select * from (values
  ('CL-01','Liberación de excavaciones','excavacion',1),
  ('CL-02','Armado de fundaciones','fundacion',2),
  ('CL-03','Encofrado de fundaciones','fundacion',3),
  ('CL-04','Armado de elementos verticales','vertical',4),
  ('CL-05','Encofrado de elementos verticales (Simmons)','vertical',5),
  ('CL-06','Armado de elementos horizontales','horizontal',6),
  ('CL-07','Encofrado de elementos horizontales (Golliat)','horizontal',7)
) as v(codigo,nombre,fase,orden)
where not exists (select 1 from sgc.cl_plantillas p where p.codigo = v.codigo);
