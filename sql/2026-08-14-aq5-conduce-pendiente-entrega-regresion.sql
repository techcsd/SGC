-- AQ5 — 🔴 REGRESIÓN: conduce creado NO aparece en "Pendiente entrega" (OTRA VEZ)
--
-- CAUSA RAÍZ (documentada para que no vuelva a pasar):
--   El fix original vive en AJ8 (2026-08-08-aj8-...): `mis_conduces_pendientes_entrega`
--   NO debe filtrar `es_prueba`, porque un chofer de QA (Papo) opera sobre
--   bodegas/proyectos de prueba, así que SUS PROPIOS conduces nacen es_prueba=true
--   (es_prueba_origen='heredado' por trigger). El aislamiento es_prueba sirve para
--   ocultar la prueba AJENA (KPIs/listados globales), NO para esconderle a alguien
--   lo suyo. AL13 (2026-08-10) preservó correctamente el fix (sin filtro es_prueba).
--
--   AM5 (2026-08-11-am5-am6-...) reintrodujo el filtro al reescribir la función para
--   añadir las columnas de ruta (ruta_id/ruta_estado/vehiculo_id/motivo/tiene_ruta):
--   partió del cuerpo pre-AJ8 y coló de nuevo
--     `and ((not coalesce(s.es_prueba,false)) or sgc.is_admin())`  (línea 142)
--   → volvió a esconderle al chofer sus conduces recién creados. Es byte-por-byte
--   el filtro que AJ8 fue escrito para borrar.
--
--   Pasó desapercibido porque: (1) el smoke de la matriz AM6 no cubría "crear →
--   aparece en pendiente"; (2) la lista web (conduces_web_listado) NO usa esta
--   función y sigue mostrando el conduce, así que en pruebas de escritorio se veía
--   bien; solo el chofer/app (mis_conduces_pendientes_entrega) quedaba a ciegas.
--
-- FIX: restaurar la semántica AJ8/AL13 — sin filtro es_prueba. Se conservan las
--   columnas de ruta de AM5 y el scope "portador actual O emisor" de AL13.
--   Aditivo/idempotente. No hay conduces varados en datos: al quitar el filtro
--   reaparecen de inmediato (nunca dejaron de existir, solo estaban filtrados).
--
-- TEST DE REGRESIÓN PERMANENTE (entra al smoke AM6): al final de este archivo.

drop function if exists sgc.mis_conduces_pendientes_entrega_count();
drop function if exists sgc.mis_conduces_pendientes_entrega();
create or replace function sgc.mis_conduces_pendientes_entrega()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, created_at timestamptz,
  ruta_id uuid, ruta_estado text, vehiculo_id uuid, motivo text, tiene_ruta boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id,
         coalesce(p.nombre, ba.nombre,
                  case when s.motivo='devolucion' then 'Devolución a suplidor' else null end) as destino,
         b.nombre, s.estado, sgc.conduce_fase(s.id), s.created_at,
         s.ruta_id, r.estado, s.vehiculo_id, s.motivo, (s.ruta_id is not null)
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   ba on ba.id = s.destino_almacen_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.rutas     r on r.id = s.ruta_id
  where (
          s.conductor_id in (select sgc.mis_conductor_ids())
          or (s.creado_por = auth.uid()
              and (s.conductor_id is null
                   or s.conductor_id in (select sgc.mis_conductor_ids())))
        )
    and coalesce(s.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
    and s.recibido_por is null
    -- ⚠️ NO filtrar por la bandera de prueba aquí (regresión AQ5/AJ8). Ver cabecera.
  order by s.created_at desc;
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega() to authenticated, service_role;

create or replace function sgc.mis_conduces_pendientes_entrega_count()
returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int from sgc.mis_conduces_pendientes_entrega();
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega_count() to authenticated, service_role;

-- ── TEST DE REGRESIÓN PERMANENTE ──────────────────────────────────────────────
-- Garantiza que la definición viva NUNCA vuelva a filtrar es_prueba en esta función.
-- Falla en el momento de aplicar la migración si alguien recae en la regresión.
do $regtest$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'mis_conduces_pendientes_entrega'
      and pronamespace = 'sgc'::regnamespace
      and pg_get_functiondef(oid) ilike '%es_prueba%'
  ) then
    raise exception 'AQ5 REGRESIÓN: mis_conduces_pendientes_entrega volvió a referenciar es_prueba en su cuerpo — no debe filtrar es_prueba (ver AJ8/AL13).';
  end if;
end
$regtest$;
