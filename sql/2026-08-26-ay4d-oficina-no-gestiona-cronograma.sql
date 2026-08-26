-- ============================================================================
-- AY4d — el Ingeniero de Oficina tampoco GESTIONA el cronograma (solo lo ve).
--
-- puede_gestionar_cronograma() permitía a cualquiera con el módulo `proyectos`
-- (incluye ahora ingeniero_oficina) importar/editar el cronograma. Consistente con
-- AY4c (oficina = solo-lectura de la ficha), oficina tampoco debe gestionar el
-- cronograma. Se cambia el grant amplio `tiene_modulo('proyectos')` por
-- `puede_gestionar_proyectos()` (módulo proyectos por un rol != ingeniero_oficina),
-- CONSERVANDO la rama de `proyecto_responsables` (el ingeniero de CAMPO encargado de
-- la obra sigue gestionando el cronograma de SU obra, aunque no tenga el módulo).
--
-- Efecto: solo cambia el ingeniero_oficina (pierde la gestión); admin, managers con
-- módulo proyectos y responsables de obra quedan igual. Cubre el import (RPC
-- cronograma_importar gatea aquí) y todas las escrituras del cronograma, y esconde
-- los botones en la app Y la web (ambas llaman a este RPC). Aditivo/retrocompatible.
-- ============================================================================

begin;
set local search_path = sgc, public;

create or replace function sgc.puede_gestionar_cronograma(p_proyecto_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'public'
as $function$
  select sgc.puede_gestionar_proyectos()
      or exists (
        select 1 from sgc.proyecto_responsables pr
        where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo
      );
$function$;

commit;

-- Verificación: gestión de cronograma por rol (parte de módulo; la rama de
-- responsables es por-obra y no se refleja aquí).
select r.codigo,
       ('proyectos' = any(r.modulos)) as tiene_modulo_proyectos,
       (r.codigo <> 'ingeniero_oficina' and 'proyectos' = any(r.modulos)) as gestiona_por_modulo
from sgc.roles r
where 'proyectos' = any(r.modulos)
order by r.codigo;
