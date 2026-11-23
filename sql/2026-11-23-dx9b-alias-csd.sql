-- DX9b (23-nov-2026) -- Yonairy: los cargos «CSD» se distinguen de los normales (Capataz ≠ Capataz CSD, Ayudante ≠ Ayudante CSD…).
-- Decisión de Xaviel (OK nombrado 23-nov). Aditivo + re-apunta alias sembrados el 5-oct que contradecían su nombre. Reversa en sql/_reversa/.
--   VARILLERO→Maestro  => Varillero      MAESTRO→Carpintero => Maestro      CAPATAZ CSD→Ingeniero => Capataz CSD (cargo nuevo)
--   OBRERO→Carpintero  => se BORRA (no hay cargo «Obrero» sin CSD; el importador sugiere «Obrero CSD» y la persona elige)
begin;
insert into sgc.cargos (codigo, nombre, descripcion, categoria, activo, orden)
values ('CAPCSD', 'Capataz CSD', 'Capataz de la plantilla CSD', 'supervision', true, 155)
on conflict (codigo) do nothing;

insert into sgc.cargo_alias (alias_normalizado, cargo_id)
select a.alias, c.id from (values ('VARILLERO', 'VAR'), ('MAESTRO', 'MAE'), ('CAPATAZ CSD', 'CAPCSD'), ('CAPATAZ', 'CAP')) as a(alias, codigo)
join sgc.cargos c on c.codigo = a.codigo
on conflict (alias_normalizado) do update set cargo_id = excluded.cargo_id;

delete from sgc.cargo_alias where alias_normalizado = 'OBRERO';
commit;
