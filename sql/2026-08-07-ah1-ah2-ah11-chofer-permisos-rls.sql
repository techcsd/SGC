-- =============================================================================
-- PROMPT-9 FASE 1 (IDs AH1, AH2, AH11) — Desbloqueo del rol CHOFER en producción
-- Ronda 2026-08-07. Aditivo y retrocompatible.
--
-- Diagnóstico (reproducido con choferes reales vía simulación de rol/JWT):
--
--  AH2 — "Obra de destino: No hay opciones" en Crear ruta (paso 2/4) y en el
--        generador de conduces. La app lee `sgc.proyectos` directamente; la
--        policy permisiva `proyectos: select` exige el módulo 'proyectos' (o ser
--        responsable/empleado). El rol Chofer (id 19: flota, inventario,
--        transporte) NO tiene 'proyectos' → 0 filas. 6/9 choferes reales (los que
--        entran por cédula+PIN, sin usuario completo) veían 0 obras.
--        FIX: la policy permisiva incluye ahora 'transporte' y 'flota' — un chofer
--        ve las obras como DESTINO. La policy RESTRICTIVA es_prueba sigue ocultando
--        las obras de prueba a los no-admin (cierra de paso una fuga).
--
--  AH1 — "Ruta creada · 1 foto · No tienes permiso para enviar esto" (SQLSTATE
--        42501). Cadena de causa: el chofer tiene asignado un vehículo es_prueba
--        (p.ej. Izuzu D-Max) → al crear la ruta, `trg_heredar_es_prueba` marca la
--        ruta es_prueba=true → la policy RESTRICTIVA `es_prueba: oculta a no-admin`
--        de `rutas` (permissive=false, se AND-ea) oculta la ruta a su PROPIO dueño
--        no-admin → el INSERT directo del app en `ruta_fotos` (WITH CHECK hace
--        EXISTS sobre `rutas`) no ve la ruta → 42501 "new row violates RLS".
--        FIX: `ruta_fotos` y `ruta_paradas` verifican propiedad con el helper
--        SECURITY DEFINER `sgc.puede_modificar_ruta(id)` (owner=postgres, BYPASSRLS
--        → ve la ruta aunque sea es_prueba). Cierra el trap para el dueño real sin
--        tocar el aislamiento es_prueba a nivel de lectura de terceros.
--
--  AH11 — Almacenes "Test" salían a choferes. Las bodegas de proyectos es_prueba
--         (Almacén TEST/Ejemplo 2/Saasasa) NO estaban marcadas es_prueba, así que
--         la policy restrictiva no las ocultaba. FIX: propagación retroactiva
--         proyecto→bodega + trigger BEFORE INSERT para heredar es_prueba de la obra.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- AH2 — El chofer (módulos flota/transporte) puede LEER obras como destino.
--       La restrictiva es_prueba ya oculta las de prueba a no-admin.
-- -----------------------------------------------------------------------------
drop policy if exists "proyectos: select" on sgc.proyectos;
create policy "proyectos: select" on sgc.proyectos
  for select using (
    sgc.is_admin()
    or sgc.tiene_modulo('proyectos')
    or sgc.tiene_modulo('transporte')   -- AH2: chofer/transportista elige obra destino
    or sgc.tiene_modulo('flota')        -- AH2: flota (rutas) elige obra destino
    or (responsable_id = auth.uid())
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = proyectos.id and e.usuario_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- AH1 — ruta_fotos / ruta_paradas: verificar propiedad con helper SECURITY
--       DEFINER (bypassa la restrictiva es_prueba de `rutas` para el dueño real).
--       `sgc.puede_modificar_ruta(uuid)` ya existe y es STABLE SECURITY DEFINER.
-- -----------------------------------------------------------------------------
drop policy if exists ruta_fotos_ins on sgc.ruta_fotos;
create policy ruta_fotos_ins on sgc.ruta_fotos
  for insert to authenticated
  with check (sgc.puede_modificar_ruta(ruta_id));

drop policy if exists ruta_fotos_sel on sgc.ruta_fotos;
create policy ruta_fotos_sel on sgc.ruta_fotos
  for select to authenticated
  using (sgc.puede_modificar_ruta(ruta_id));

drop policy if exists ruta_paradas_ins on sgc.ruta_paradas;
create policy ruta_paradas_ins on sgc.ruta_paradas
  for insert to authenticated
  with check (sgc.puede_modificar_ruta(ruta_id));

drop policy if exists ruta_paradas_upd on sgc.ruta_paradas;
create policy ruta_paradas_upd on sgc.ruta_paradas
  for update to authenticated
  using (sgc.puede_modificar_ruta(ruta_id))
  with check (sgc.puede_modificar_ruta(ruta_id));

drop policy if exists ruta_paradas_del on sgc.ruta_paradas;
create policy ruta_paradas_del on sgc.ruta_paradas
  for delete to authenticated
  using (sgc.puede_modificar_ruta(ruta_id));

-- -----------------------------------------------------------------------------
-- AH11 — bodegas de prueba: heredar es_prueba de la obra (retroactivo + forward).
-- -----------------------------------------------------------------------------
-- Forward: al crear una bodega ligada a una obra es_prueba, hereda la marca.
create or replace function sgc.tg_bodega_hereda_es_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
begin
  if coalesce(NEW.es_prueba, false) then
    return NEW; -- ya marcada explícitamente
  end if;
  if NEW.proyecto_id is not null
     and coalesce((select es_prueba from sgc.proyectos where id = NEW.proyecto_id), false) then
    NEW.es_prueba := true;
    NEW.es_prueba_origen := 'heredado';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_bodega_hereda_es_prueba on sgc.bodegas;
create trigger trg_bodega_hereda_es_prueba
  before insert on sgc.bodegas
  for each row execute function sgc.tg_bodega_hereda_es_prueba();

-- Retroactivo: marca las bodegas cuya obra es de prueba (dispara trg_cascada_prueba).
update sgc.bodegas b
   set es_prueba = true,
       es_prueba_origen = coalesce(b.es_prueba_origen, 'heredado')
  from sgc.proyectos p
 where b.proyecto_id = p.id
   and coalesce(p.es_prueba, false) = true
   and coalesce(b.es_prueba, false) = false;

commit;
