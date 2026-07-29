-- ============================================================================
-- PROMPT-9 · FASE 5 — AA10: catálogo administrable de equipos de bitácora
-- Fecha: 2026-07-29. Aditivo / idempotente.
--
-- Problema: la lista de "equipos alquilados" del parte diario salía de texto
-- libre + sugerencias históricas (bitacora_equipos_alquilados + otros_valores),
-- así que basura tecleada una vez ("addsss", "Mangosta") quedaba como sugerencia
-- permanente. No había catálogo curado ni CRUD admin.
--
-- Modelo final (documentado): equipos = CATÁLOGO ADMINISTRABLE
-- (bitacora_catalogos tipo='equipo', CRUD en Admin › Catálogos de bitácora) +
-- historial por obra. El form sugiere ambos (curado primero, luego lo visto en
-- la obra). Se limpian los valores basura del seed histórico.
-- ============================================================================

-- (1) Permitir el tipo 'equipo' en el catálogo de bitácora.
alter table sgc.bitacora_catalogos drop constraint if exists bitacora_catalogos_tipo_check;
alter table sgc.bitacora_catalogos add constraint bitacora_catalogos_tipo_check
  check (tipo = any (array['estructura','actividad','restriccion',
    'suceso_incidente','suceso_accidente','suceso_equipo','equipo']));

-- (2) Semilla de equipos reales (curados). Idempotente por (tipo, valor).
insert into sgc.bitacora_catalogos (tipo, valor, activo, orden)
select 'equipo', v, true, ord
from (values
  ('Camión Volteo', 1), ('Retroexcavadora', 2), ('Excavadora', 3),
  ('Telehandler', 4), ('Compactadora', 5), ('Bulldozer', 6),
  ('Grúa', 7), ('Mixer / Hormigonera', 8), ('Bomba de agua', 9),
  ('Generador eléctrico', 10), ('Sierra eléctrica', 11), ('Compresor', 12),
  ('Montacargas', 13), ('Vibrador de concreto', 14), ('Andamios', 15)
) as s(v, ord)
where not exists (
  select 1 from sgc.bitacora_catalogos c where c.tipo = 'equipo' and lower(c.valor) = lower(s.v)
);

-- (3) Limpieza de basura del seed histórico (sugerencias). No borra partes; solo
--     quita valores basura de las fuentes de sugerencia.
delete from sgc.otros_valores
 where contexto = 'bitacora_equipo_alquilado'
   and lower(trim(valor)) in ('addsss', 'mangosta');

-- (Los partes reales en bitacora_equipos_alquilados no se tocan, pero se excluye
--  la basura evidente de la sugerencia en el RPC de abajo por lista negra.)

-- (4) equipos_de_obra: unir el CATÁLOGO curado + historial de la obra, filtrando
--     basura conocida. El catálogo aparece siempre (aunque la obra no tenga uno).
create or replace function sgc.equipos_de_obra(p_proyecto_id uuid)
returns table(nombre text, veces bigint)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  with fuente as (
    -- catálogo curado (peso alto para que salga primero)
    select c.valor as nombre, 1000::bigint as w
    from sgc.bitacora_catalogos c
    where c.tipo = 'equipo' and coalesce(c.activo, true)
    union all
    select bea.equipo, 1::bigint
    from sgc.bitacora_equipos_alquilados bea
    join sgc.bitacoras b on b.id = bea.bitacora_id
    where b.proyecto_id = p_proyecto_id
    union all
    select b.incidente_equipo_nombre, 1::bigint
    from sgc.bitacoras b
    where b.proyecto_id = p_proyecto_id and b.incidente_equipo_nombre is not null
    union all
    select ov.valor, 1::bigint
    from sgc.otros_valores ov
    join sgc.bitacoras b on b.id = ov.referencia_id
    where ov.contexto = 'bitacora_equipo_alquilado' and b.proyecto_id = p_proyecto_id
  ),
  norm as (
    select trim(nombre) as nombre,
           lower(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as clave,
           w
    from fuente
    where coalesce(trim(nombre), '') <> ''
      and lower(trim(nombre)) not in ('addsss', 'mangosta')  -- lista negra
  )
  select (array_agg(nombre order by nombre))[1] as nombre, sum(w) as veces
  from norm
  group by clave
  order by veces desc, nombre asc;
$function$;
