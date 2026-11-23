-- DX9 (ronda 23-nov-2026) -- cargos pedidos por Yonairy («Algunas mejoras a implementar», reporte del 23-nov):
-- Ayudante CSD, Obrero CSD, Ayudante de carpintería, Ayudante de varillero, Ayudante de maestro.
-- ADITIVO: no renombra ni borra ningún cargo. Categoría `obrero` (misma de AYU).
-- Hallazgo F0 (NO se toca aquí, decisión de Xaviel/Yonairy): cargo_alias trae 5 alias sembrados el 5-oct (CG2) que
-- contradicen su propio nombre: VARILLERO→Maestro, MAESTRO→Carpintero, OBRERO→Carpintero, CAPATAZ CSD→Ingeniero.
-- Solo se re-apunta AYUDANTE CSD (hoy → Varillero) porque es exactamente lo que se pidió; el valor anterior queda en la reversa.
begin;

insert into sgc.cargos (codigo, nombre, descripcion, categoria, activo, orden) values
  ('AYUCSD',  'Ayudante CSD',            'Ayudante de la plantilla CSD', 'obrero', true, 150),
  ('OBRCSD',  'Obrero CSD',              'Obrero de la plantilla CSD',   'obrero', true, 151),
  ('AYUCARP', 'Ayudante de carpintería', 'Ayudante del carpintero',      'obrero', true, 152),
  ('AYUVAR',  'Ayudante de varillero',   'Ayudante del varillero',       'obrero', true, 153),
  ('AYUMAE',  'Ayudante de maestro',     'Ayudante del maestro',         'obrero', true, 154)
on conflict (codigo) do nothing;

insert into sgc.cargo_alias (alias_normalizado, cargo_id)
select a.alias, c.id from (values
  ('AYUDANTE CSD', 'AYUCSD'), ('OBRERO CSD', 'OBRCSD'),
  ('AYUDANTE DE CARPINTERIA', 'AYUCARP'), ('AYUDANTE CARPINTERIA', 'AYUCARP'),
  ('AYUDANTE DE VARILLERO', 'AYUVAR'), ('AYUDANTE VARILLERO', 'AYUVAR'),
  ('AYUDANTE DE MAESTRO', 'AYUMAE'), ('AYUDANTE MAESTRO', 'AYUMAE')
) as a(alias, codigo) join sgc.cargos c on c.codigo = a.codigo
on conflict (alias_normalizado) do update set cargo_id = excluded.cargo_id;

commit;
