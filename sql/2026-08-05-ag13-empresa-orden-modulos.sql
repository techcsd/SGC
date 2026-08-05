-- ============================================================================
-- AG13 — Consolidación de Administración: (1) Empresa / parámetros generales
-- (datos de la constructora) y (2) Orden de módulos del menú (AF38). Aditivo.
-- ============================================================================

set search_path = sgc, public;

-- ── (1) Empresa: fila única de configuración de la empresa ──────────────────
create table if not exists sgc.empresa (
  id               int primary key default 1,
  razon_social     text,
  nombre_comercial text,
  rnc              text,
  direccion        text,
  ciudad           text,
  pais             text default 'República Dominicana',
  telefono         text,
  email            text,
  sitio_web        text,
  logo_path        text,
  updated_at       timestamptz not null default now(),
  constraint empresa_single_row check (id = 1)
);

insert into sgc.empresa (id, razon_social, nombre_comercial)
values (1, 'Constructora SD', 'Constructora SD')
on conflict (id) do nothing;

alter table sgc.empresa enable row level security;
-- Todos los autenticados pueden LEER (nombre/logo pueden usarse en documentos);
-- solo admin edita.
drop policy if exists empresa_sel on sgc.empresa;
create policy empresa_sel on sgc.empresa for select using (auth.role() = 'authenticated');
drop policy if exists empresa_upd on sgc.empresa;
create policy empresa_upd on sgc.empresa for update using (sgc.is_admin()) with check (sgc.is_admin());
grant select, update on sgc.empresa to authenticated;

-- ── (2) AF38 — orden de los módulos/secciones del menú ──────────────────────
-- Guarda un orden por clave de sección de navegación. El shell ordena por este
-- valor; cualquier sección sin fila conserva su posición original (fallback).
create table if not exists sgc.modulo_orden (
  clave      text primary key,   -- ruta o etiqueta estable del nav item
  etiqueta   text,
  orden      int not null,
  updated_at timestamptz not null default now()
);

alter table sgc.modulo_orden enable row level security;
drop policy if exists modulo_orden_sel on sgc.modulo_orden;
create policy modulo_orden_sel on sgc.modulo_orden for select using (auth.role() = 'authenticated');
drop policy if exists modulo_orden_all on sgc.modulo_orden;
create policy modulo_orden_all on sgc.modulo_orden for all using (sgc.is_admin()) with check (sgc.is_admin());
grant select, insert, update, delete on sgc.modulo_orden to authenticated;
