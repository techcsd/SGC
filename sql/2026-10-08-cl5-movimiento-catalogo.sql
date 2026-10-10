-- 2026-10-08-cl5-movimiento-catalogo.sql — CL5 (reglas 18/19)
--
-- Catálogo de todo el movimiento/animaciones del sistema (nota #190), que pinta la
-- pantalla Administración › Animaciones (solo consulta). Lo llenan scripts versionados
-- por repo (web y app) desde su registro `catalogo-movimiento.ts` — así la web muestra
-- también las animaciones de la app sin compilarla dentro.
--
--   node scripts/apply-migration.mjs sql/2026-10-08-cl5-movimiento-catalogo.sql --env dev
--   node scripts/apply-migration.mjs sql/2026-10-08-cl5-movimiento-catalogo.sql --env prod  (tras OK)

begin;

create table if not exists sgc.movimiento_catalogo (
  sistema        text    not null check (sistema in ('web','app')),
  id             text    not null,
  nombre         text    not null,
  nivel          text    not null check (nivel in ('grande','mediano','base')),
  donde          text    not null default '',
  pantallas      text[]  not null default array[]::text[],
  duracion_ms    integer not null default 0,
  curva          text    not null default '',
  reducido       text    not null default '',
  desde_version  text    not null default '',
  preview_key    text    not null default '',
  estado         text    not null default 'en_uso' check (estado in ('en_uso','pendiente')),
  actualizado_en timestamptz not null default now(),
  primary key (sistema, id)
);

alter table sgc.movimiento_catalogo enable row level security;

-- Lectura: solo admin y tecnología (es un panel de Administración).
drop policy if exists movimiento_catalogo_sel on sgc.movimiento_catalogo;
create policy movimiento_catalogo_sel on sgc.movimiento_catalogo
  for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());

-- Escritura: solo el service role (los scripts de release). Sin política para
-- authenticated → nadie más puede insertar/actualizar/borrar.

grant select on sgc.movimiento_catalogo to authenticated;
grant select, insert, update, delete on sgc.movimiento_catalogo to service_role;

commit;
