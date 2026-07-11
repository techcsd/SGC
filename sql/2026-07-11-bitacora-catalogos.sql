-- SGC · Catálogos de bitácora gestionables por admin (estructuras, actividades,
-- restricciones). Antes eran CHECK constraints fijos + constantes hardcodeadas.
-- Al volverlos catálogo, admin puede agregar valores nuevos y el app + web los
-- ofrecen automáticamente. Se quitan los CHECK para aceptar valores nuevos
-- (la validación pasa a ser el catálogo activo).
-- Apply: node scripts/apply-migration.mjs "<path>/2026-07-11-bitacora-catalogos.sql"

create table if not exists sgc.bitacora_catalogos (
  id          serial primary key,
  tipo        text not null check (tipo in ('estructura','actividad','restriccion')),
  valor       text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tipo, valor)
);

insert into sgc.bitacora_catalogos (tipo, valor) values
  ('estructura','COLUMNAS'), ('estructura','MUROS'), ('estructura','VIGAS'),
  ('estructura','LOSAS'), ('estructura','ZAPATAS/PLATEA'), ('estructura','VIGAS RIOSTRAS'),
  ('actividad','TOPOGRAFIA'), ('actividad','CEPOS'), ('actividad','ENCOFRADO'),
  ('actividad','ARMADO'), ('actividad','LIBERACION MIVED'),
  ('actividad','TERMINACIONES DE ENCOFRADO/ARMADO'), ('actividad','VACIADO'),
  ('actividad','DESENCOFRADO'),
  ('restriccion','NINGUNA'), ('restriccion','FALTA DE MATERIALES'),
  ('restriccion','FALTA DE EQUIPOS/HERRAMIENTAS'), ('restriccion','INTERFERENCIA DE OTRAS BRIGADAS'),
  ('restriccion','FALTA DE LIBERACION PARA INICIO DE TRABAJOS'), ('restriccion','FALTA DEL CLIENTE'),
  ('restriccion','CLIMA'), ('restriccion','OTRO')
on conflict (tipo, valor) do nothing;

-- Drop the fixed CHECKs so admin-added values are accepted (catalog-validated).
alter table sgc.bitacora_actividades drop constraint if exists bitacora_actividades_estructura_check;
alter table sgc.bitacora_actividades drop constraint if exists bitacora_actividades_actividad_check;
alter table sgc.bitacora_restricciones drop constraint if exists bitacora_restricciones_tipo_restriccion_check;

alter table sgc.bitacora_catalogos enable row level security;
drop policy if exists "bcat_select" on sgc.bitacora_catalogos;
create policy "bcat_select" on sgc.bitacora_catalogos for select to authenticated using (true);
drop policy if exists "bcat_write" on sgc.bitacora_catalogos;
create policy "bcat_write" on sgc.bitacora_catalogos for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.bitacora_catalogos to authenticated;
grant usage, select on sequence sgc.bitacora_catalogos_id_seq to authenticated;

comment on table sgc.bitacora_catalogos is
  'Catálogo gestionable de estructuras/actividades/restricciones de bitácora.';
