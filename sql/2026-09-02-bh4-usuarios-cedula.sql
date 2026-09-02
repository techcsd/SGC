-- ════════════════════════════════════════════════════════════════════════════
-- BH4 — La cédula pasa a ser identidad de primera clase.
--
-- Hasta hoy el email (sintético para el personal de campo: cap-<cedula>@…,
-- c-<cedula>@…) era la llave de facto, y `usuarios` no tenía columna `cedula`.
-- Esto agrega la columna + índice UNIQUE PARCIAL (solo donde cedula is not null),
-- para que "esta persona ya existe" deje de ser un aviso (AU18) y sea un bloqueo
-- con salida útil. Es el fix estructural de BH6 (tarea a la persona equivocada).
--
-- ⚠️ NO se hace backfill automático desde los emails sintéticos aquí: si existen
-- dos filas con la misma cédula (justo el duplicado que perseguimos), el índice
-- unique fallaría. El backfill va en un paso guardado aparte que PRIMERO reporta
-- y consolida los duplicados. Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

alter table sgc.usuarios
  add column if not exists cedula text;

comment on column sgc.usuarios.cedula is
  'BH4 — cédula como identidad (nullable; unique parcial). Para personal de campo sin '
  'correo real que entra por cédula + PIN. El email puede ser sintético (cap-/c-<cedula>@…).';

-- Solo se normaliza a dígitos si viene con separadores.
create unique index if not exists usuarios_cedula_uidx
  on sgc.usuarios (cedula) where cedula is not null;

commit;

-- ── Diagnóstico de duplicados por cédula (correr aparte, NO en la migración) ──
-- Antes de backfillear, ver si hay personas con dos filas:
--   select regexp_replace(split_part(email,'@',1),'^(cap-|c-)','') as ced, count(*)
--   from sgc.usuarios
--   where email like 'cap-%@personal.constructorasd.local'
--      or email like 'c-%@conductores.constructorasd.local'
--   group by 1 having count(*) > 1;
