-- 2026-11-02-dg5-mas-datos-demo.sql — DG5 (reglas 18/19) — módulo "Demo" ampliado
--
-- Más datos DEMO-* para practicar (pantalla "Escenarios" del módulo Demo): más obras,
-- almacenes, artículos, choferes y vehículos. Mismo patrón que ya existía (CI11
-- scripts/data-fixes/2026-10-07-ci11-obra-demo.mjs + CK5 sql/2026-10-08-ck5-usuarios-demo.sql):
-- prefijo DEMO- / "DEMO" en el nombre + es_prueba=true. Aditivo e idempotente
-- (on conflict / where not exists). NO toca revisor_tiendas, revisor_solo_demo ni
-- sgc.es_usuario_demo() — ver sql/2026-10-09-ck-demo-visibilidad.sql (eso sigue intacto).
--
-- También agrega una RPC de solo lectura `sgc.demo_catalogo()` para la pantalla
-- "Escenarios" (visible a CUALQUIER autenticado, sin gate de módulo, como el resto del
-- módulo Demo): SECURITY DEFINER que filtra EXPLÍCITAMENTE `es_prueba=true`, así que
-- nunca expone datos reales aunque la RLS de la tabla base los escondiera por rol.
--
--   node scripts/apply-migration.mjs sql/2026-11-02-dg5-mas-datos-demo.sql --env dev

begin;

-- 1) Dos obras demo adicionales (ya existía 'DEMO-001' desde CI11).
insert into sgc.proyectos (codigo, nombre, es_prueba, activo, estado)
values
  ('DEMO-002', 'OBRA DEMO — Torre Norte', true, true, 'en_ejecucion'),
  ('DEMO-003', 'OBRA DEMO — Residencial Sur', true, true, 'en_ejecucion')
on conflict (codigo) do update set nombre = excluded.nombre, es_prueba = true;

-- 2) Un almacén de obra demo por cada obra nueva.
insert into sgc.bodegas (nombre, descripcion, ubicacion, activo, proyecto_id, es_principal_obra, es_prueba)
select 'Almacén ' || p.nombre, 'Almacén de obra (demo, para practicar)', null, true, p.id, true, true
from sgc.proyectos p
where p.codigo in ('DEMO-002', 'DEMO-003')
  and not exists (select 1 from sgc.bodegas b where b.proyecto_id = p.id and coalesce(b.es_prueba, false));

-- 3) Artículos demo adicionales (ya existían 3 vía CI11/CK5; aquí 5 más).
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, activo, es_prueba, stock_minimo)
select v.codigo, v.nombre, v.unidad, cat.id, true, true, 0
from (values
  ('DEMO-ART-001', 'Cemento gris 42.5 (saco) — demo', 'ud'),
  ('DEMO-ART-002', 'Varilla 1/2" (unidad) — demo', 'ud'),
  ('DEMO-ART-003', 'Bloque 6" (unidad) — demo', 'ud'),
  ('DEMO-ART-004', 'Arena lavada (m3) — demo', 'm3'),
  ('DEMO-ART-005', 'Pintura blanca (galón) — demo', 'gl')
) as v(codigo, nombre, unidad)
cross join lateral (select id from sgc.categorias_inventario order by id limit 1) cat
where not exists (select 1 from sgc.articulos a where a.codigo = v.codigo);

-- 4) Vehículos demo adicionales (ya existía 'DEMO-001' desde CI11).
insert into sgc.vehiculos (placa, marca, modelo, anio, tipo, es_prueba, activo)
values
  ('DEMO-002', 'Hino', '300', 2021, 'camion', true, true),
  ('DEMO-003', 'Daihatsu', 'Gran Max', 2020, 'pickup', true, true)
on conflict (placa) do update set es_prueba = true;

-- 5) Choferes demo adicionales (sin usuario Auth propio — solo nombre, para los
--    pickers/escenarios de referencia; ya existía "Chofer Demo" ligado al usuario
--    revisor desde CI11).
insert into sgc.conductores (nombre, cedula, licencia_tipo, activo, es_prueba)
select v.nombre, v.cedula, 'Categoría 3', true, true
from (values
  ('Chofer Demo 2', '000-0000002-0'),
  ('Chofer Demo 3', '000-0000003-0')
) as v(nombre, cedula)
where not exists (select 1 from sgc.conductores c where c.cedula = v.cedula);

-- 6) Catálogo de misiones ampliado (práctica web) — las 8 misiones nuevas de F6 (DG5).
--    mision_id no tiene FK desde practica_intentos (es texto libre); este insert solo
--    completa el catálogo admin-facing `sgc.practica_misiones` para que coincida con
--    `MISIONES_PILOTO` en el cliente.
insert into sgc.practica_misiones (id, plataforma, roles, titulo, version) values
  ('web-registrar-bitacora',      'web', '{}', 'Registrar bitácora', 1),
  ('web-crear-conduce',           'web', '{}', 'Crear un conduce', 1),
  ('web-echar-combustible',       'web', '{}', 'Echar combustible', 1),
  ('web-checklist-vehiculo',      'web', '{}', 'Checklist de vehículo', 1),
  ('web-crear-solicitud-compra',  'web', '{}', 'Crear solicitud de compra', 1),
  ('web-registrar-mantenimiento', 'web', '{}', 'Registrar mantenimiento', 1),
  ('web-crear-ruta',              'web', '{}', 'Crear una ruta', 1),
  ('web-crear-orden-trabajo',     'web', '{}', 'Crear orden de trabajo', 1)
on conflict (id) do nothing;

-- 7) RPC de solo lectura para la pantalla "Escenarios" (módulo Demo, sin gate — como
--    Mensajes/Notas). Filtra es_prueba=true EXPLÍCITAMENTE: no depende de qué vea el rol
--    del que llama, así nunca se cuela un dato real aunque algún día cambie la RLS base.
create or replace function sgc.demo_catalogo()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    'obras', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre) order by p.codigo)
      from sgc.proyectos p where coalesce(p.es_prueba, false)
    ), '[]'::jsonb),
    'almacenes', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre, 'proyecto_id', b.proyecto_id) order by b.nombre)
      from sgc.bodegas b where coalesce(b.es_prueba, false)
    ), '[]'::jsonb),
    'articulos', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'nombre', a.nombre, 'unidad', a.unidad) order by a.codigo)
      from sgc.articulos a where coalesce(a.es_prueba, false)
    ), '[]'::jsonb),
    'vehiculos', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'placa', v.placa, 'marca', v.marca, 'modelo', v.modelo, 'tipo', v.tipo) order by v.placa)
      from sgc.vehiculos v where coalesce(v.es_prueba, false)
    ), '[]'::jsonb),
    'choferes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.nombre)
      from sgc.conductores c where coalesce(c.es_prueba, false)
    ), '[]'::jsonb)
  );
$function$;
grant execute on function sgc.demo_catalogo() to authenticated, service_role;

commit;
