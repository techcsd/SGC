-- Vehicle load capacity was a free-text field ("10 toneladas" / "10t" / "10000kg"),
-- so it couldn't be compared or aggregated. Split into a numeric value + a unit
-- so it becomes structured/queryable. The old free-text column is kept for
-- legacy rows; the form now writes the structured fields.
alter table sgc.vehiculos
  add column if not exists capacidad_valor  numeric(10, 2),
  add column if not exists capacidad_unidad text check (capacidad_unidad in ('t', 'kg', 'm3'));
