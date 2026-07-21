-- ============================================================================
-- Actualización 3 · S12 (tipo "incidente de equipos") + S13 ("¿Qué pasó?" con
-- opciones probables por tipo). Solo DDL + seeds; los RPC se re-crean en
-- 2026-07-21-act3-rpc-bitacora.sql.
-- Aditivo / idempotente / retrocompatible.
-- ============================================================================
set search_path = sgc, public;

-- ── S12) Ampliar el tipo de incidente ──────────────────────────────────────
alter table sgc.bitacoras drop constraint if exists bitacoras_incidente_tipo_check;
alter table sgc.bitacoras add constraint bitacoras_incidente_tipo_check
  check (incidente_tipo is null or incidente_tipo in ('incidente','accidente','incidente_equipo'));

-- Campos aditivos del tipo "incidente_equipo".
alter table sgc.bitacoras
  add column if not exists incidente_equipo_nombre    text,
  add column if not exists incidente_equipo_alquilado boolean,
  add column if not exists incidente_equipo_operativo boolean;
comment on column sgc.bitacoras.incidente_equipo_nombre    is 'Equipo afectado (tipo incidente_equipo).';
comment on column sgc.bitacoras.incidente_equipo_alquilado is 'Equipo propio(false)/alquilado(true).';
comment on column sgc.bitacoras.incidente_equipo_operativo is '¿Queda operativo tras el suceso?';

-- ── S13) Suceso probable (texto elegido del catálogo o "Otro" libre) ─────────
alter table sgc.bitacoras add column if not exists incidente_suceso text;
comment on column sgc.bitacoras.incidente_suceso is
  'Suceso probable del incidente (catálogo suceso_*). "Otro" = texto libre → otros_valores.';

-- ── S13) Catálogo de sucesos probables por tipo ─────────────────────────────
-- Reutiliza sgc.bitacora_catalogos con tipos nuevos. Se amplía el CHECK de tipo.
alter table sgc.bitacora_catalogos drop constraint if exists bitacora_catalogos_tipo_check;
alter table sgc.bitacora_catalogos add constraint bitacora_catalogos_tipo_check
  check (tipo in ('estructura','actividad','restriccion',
                  'suceso_incidente','suceso_accidente','suceso_equipo'));

insert into sgc.bitacora_catalogos (tipo, valor, orden) values
  -- Accidente (con lesionados)
  ('suceso_accidente','SE CLAVO UN CLAVO',1),
  ('suceso_accidente','CAIDA DE ALTURA',2),
  ('suceso_accidente','GOLPE CON OBJETO',3),
  ('suceso_accidente','CORTE CON HERRAMIENTA',4),
  ('suceso_accidente','CONTACTO ELECTRICO',5),
  -- Incidente de equipo
  ('suceso_equipo','FALLA MECANICA',1),
  ('suceso_equipo','GOLPE/IMPACTO',2),
  ('suceso_equipo','VUELCO',3),
  ('suceso_equipo','ROBO/PERDIDA',4),
  -- Incidente (sin lesionados)
  ('suceso_incidente','CASI ACCIDENTE',1),
  ('suceso_incidente','CONDICION INSEGURA',2),
  ('suceso_incidente','DANO A PROPIEDAD',3)
on conflict (tipo, valor) do update set orden = excluded.orden;
