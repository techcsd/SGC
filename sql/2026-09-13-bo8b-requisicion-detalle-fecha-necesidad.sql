-- ============================================================================
-- PROMPT-44 (BO) FASE 6 — BO8b: exponer fecha_necesidad en la LECTURA del detalle.
-- Ronda 13/09/2026.  Aditivo, retrocompatible, idempotente.
--
-- Complemento de 2026-09-13-bo8-fecha-necesidad-requisicion.sql (que añadió la
-- columna + el parámetro en las DOS RPCs de creación).  Ese archivo cubrió la
-- ESCRITURA; faltaba la LECTURA: `requisicion_detalle` no devolvía la columna, así
-- que ni la app ni la web podían mostrar "para cuándo se necesita".
--
-- Cambio: se añade una sola clave `fecha_necesidad` al jsonb que arma
-- `requisicion_detalle`.  Es puramente aditivo — el resto del cuerpo es copia
-- VERBATIM (mismo gate de autorización SECURITY DEFINER, mismos joins).  Clientes
-- viejos (web/app) ignoran la clave nueva; ninguno se rompe.  Sin cambios de
-- RLS/grants (la función ya existía con los mismos permisos).
--
-- Origen: detectado y aplicado desde el repo csd-app (hijo) — la app "Mis
-- requisiciones" ahora pinta "📅 Necesita para" en el detalle.  Espejo aquí por la
-- regla madre #5 (mantener el historial del backend compartido en sync).  La web
-- puede pintarla también en su detalle (parity opcional, pendiente).
--
-- Estado: APLICADO a prod el 13/09/2026 (vía csd-app/scripts/apply-migration.mjs).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-13-bo8b-requisicion-detalle-fecha-necesidad.sql
-- ============================================================================

begin;

create or replace function sgc.requisicion_detalle(p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_owner uuid;
  v jsonb;
begin
  select solicitante_id into v_owner from sgc.solicitudes_material where id = p_id;
  if v_owner is null then return null; end if;
  if not (sgc.puede_ver_todas_requisiciones() or v_owner = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', s.id, 'estado', s.estado, 'urgencia', s.urgencia, 'notas', s.notas,
    'created_at', s.created_at, 'updated_at', s.updated_at, 'atendido_en', s.atendido_en,
    'proyecto_id', s.proyecto_id, 'proyecto_nombre', p.nombre,
    -- BO8b — fecha en que se necesita el material (nullable).
    'fecha_necesidad', s.fecha_necesidad,
    'solicitante_id', s.solicitante_id, 'solicitante_nombre', u.nombre,
    'atendido_por_nombre', ua.nombre,
    'salida_id', s.salida_id, 'solicitud_compra_id', s.solicitud_compra_id,
    -- BC4 — código citable + contexto etiquetado.
    'folio', s.folio,
    'solicitante_rol', (
      select coalesce(r.nombre, r.codigo)
      from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = s.solicitante_id
      order by r.id
      limit 1
    ),
    -- BB10 — versión (sube en cada edición del autor).
    'version', coalesce(s.version, 1),
    -- BA6 — cierre / cancelación (motivo + quién + cuándo).
    'cancelada_motivo', s.cancelada_motivo,
    'cerrada_en', s.cerrada_en,
    'cerrada_por_nombre', uc.nombre,
    -- BF6 — motivo del rechazo (columna propia; para corregir y reenviar).
    'motivo_rechazo', s.motivo_rechazo,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'descripcion', coalesce(nullif(i.descripcion, ''), a.nombre),
        'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla,
        'articulo_id', i.articulo_id, 'codigo', a.codigo
      ) order by coalesce(nullif(i.descripcion, ''), a.nombre))
      from sgc.solicitud_material_items i
      left join sgc.articulos a on a.id = i.articulo_id
      where i.solicitud_id = s.id
    ), '[]'::jsonb)
  ) into v
  from sgc.solicitudes_material s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.usuarios  u on u.id = s.solicitante_id
  left join sgc.usuarios  ua on ua.id = s.atendido_por
  left join sgc.usuarios  uc on uc.id = s.cerrada_por
  where s.id = p_id;

  return v;
end;
$function$;

commit;
