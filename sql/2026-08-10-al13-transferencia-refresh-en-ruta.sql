-- =============================================================================
-- PROMPT-3 FASE 1 (AL13) — Transferencia de conduces: BUG del refresh + transferir
-- un conduce ya iniciado (en ruta). Ronda 10/08/2026 (IDs AL). SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- BUG RAÍZ (Eduardo NG → Papo): Papo acepta la transferencia, pero a Eduardo el
--   conduce le sigue saliendo en "Pendiente entrega". Causa confirmada:
--   `mis_conduces_pendientes_entrega()` filtra
--       (s.conductor_id ∈ mis_conductor_ids()  OR  s.creado_por = auth.uid())
--   La aceptación (aceptar_transferencia_conduce, AH5) reasigna
--   `salidas_inventario.conductor_id` → Papo pero NO toca `creado_por` (= Eduardo).
--   Por eso Eduardo sigue cumpliendo la rama `creado_por` y ve el conduce para
--   siempre; Papo también lo ve (por conductor_id) → aparece en AMBAS listas.
--   (El "código" del conduce se deriva del id (CND-<id8>) y los materiales viven
--    en detalle_salidas por salida_id; server-side NO se pierde nada. El síntoma
--    "se pierde el código/materiales" es render app-side de una fila vieja: se
--    resuelve con el contrato de detalle de abajo + refresh app en PROMPT-4.)
--
-- FIX (semántica correcta de "pendiente entrega" = entregas que YO cargo HOY):
--   la lista se ancla al PORTADOR ACTUAL. La rama `creado_por` se conserva solo
--   para el conduce que aún no tiene chofer asignado o cuyo chofer soy yo (el caso
--   del chofer que crea su propio conduce). En cuanto se transfiere a otro chofer,
--   el emisor deja de verlo al instante.
--
-- AL13.2 — transferir un conduce YA INICIADO (en ruta): se permite ofrecer en
--   fase 'emitido' y 'en_transito' (decisión Xaviel); se BLOQUEA en 'entregando',
--   'entregado', 'pendiente_firma' y 'confirmado'. Se registra la fase en que iba
--   cada transferencia (historial quién→quién, cuándo, en qué estado).
-- =============================================================================

begin;

-- ── 0) Historial: capturar la fase en que iba el conduce al transferirse ──────
alter table sgc.conduce_transferencias
  add column if not exists fase_al_transferir text;
comment on column sgc.conduce_transferencias.fase_al_transferir is
  'AL13 — fase del conduce (conduce_fase) al momento de OFRECER la transferencia (emitido|en_transito).';

-- ── 1) FIX del refresh: pendiente entrega anclada al PORTADOR ACTUAL ──────────
drop function if exists sgc.mis_conduces_pendientes_entrega_count();
drop function if exists sgc.mis_conduces_pendientes_entrega();
create or replace function sgc.mis_conduces_pendientes_entrega()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id, p.nombre, b.nombre, s.estado,
         sgc.conduce_fase(s.id), s.created_at
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  where (
          -- soy el portador (chofer) actual del conduce
          s.conductor_id in (select sgc.mis_conductor_ids())
          -- o lo creé y todavía NO tiene otro chofer al mando (self-created / sin asignar).
          -- En cuanto se transfiere a otro chofer, esta rama deja de cumplirse y el
          -- emisor deja de verlo (fix AL13 del refresh).
          or (s.creado_por = auth.uid()
              and (s.conductor_id is null
                   or s.conductor_id in (select sgc.mis_conductor_ids())))
        )
    and coalesce(s.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
    and s.recibido_por is null
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

-- ── 2) Gate de fase en la OFERTA + registro de la fase al transferir ─────────
-- Se puede transferir en 'emitido' y 'en_transito'; NO en 'entregando' ni después.
create or replace function sgc.ofrecer_transferencia_conduce(
  p_salida_id uuid, p_a_conductor_id uuid, p_notas text default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_salida sgc.salidas_inventario%rowtype;
  v_es_flota boolean := sgc.is_admin() or sgc.es_flota_elevado();
  v_soy_responsable boolean;
  v_a_usuario uuid; v_de_nombre text; v_id uuid; v_es_prueba boolean; v_fase text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado'; end if;

  -- Solo el responsable actual (chofer del conduce) o flota/admin pueden ofrecer.
  v_soy_responsable := exists (
    select 1 from sgc.conductores c
    where c.id = v_salida.conductor_id and c.usuario_id = v_uid);
  if not (v_soy_responsable or v_es_flota) then
    raise exception 'Solo el chofer responsable o Flota puede transferir este conduce';
  end if;

  -- AL13.2 — gate de fase: solo emitido / en_transito.
  v_fase := sgc.conduce_fase(p_salida_id);
  if v_fase not in ('emitido','en_transito') then
    raise exception 'Este conduce ya no se puede transferir (está en fase "%"). Solo se transfiere emitido o en ruta.', v_fase
      using errcode = 'DR423';
  end if;

  if p_a_conductor_id = v_salida.conductor_id then
    raise exception 'El conduce ya está a cargo de ese chofer';
  end if;
  if not exists (select 1 from sgc.conductores where id = p_a_conductor_id and coalesce(activo,true)) then
    raise exception 'Chofer destino no válido';
  end if;

  -- Una sola oferta activa por conduce.
  if exists (select 1 from sgc.conduce_transferencias
             where salida_id = p_salida_id and estado = 'ofrecida') then
    raise exception 'Ya hay una transferencia pendiente para este conduce';
  end if;

  v_es_prueba := coalesce(v_salida.es_prueba, false);
  insert into sgc.conduce_transferencias (
    salida_id, de_conductor_id, a_conductor_id, ofrecida_por, notas,
    fase_al_transferir, es_prueba, es_prueba_origen)
  values (p_salida_id, v_salida.conductor_id, p_a_conductor_id, v_uid, nullif(trim(p_notas),''),
          v_fase, v_es_prueba, case when v_es_prueba then 'heredado' else 'manual' end)
  returning id into v_id;

  -- Push AF7 al chofer receptor.
  select usuario_id into v_a_usuario from sgc.conductores where id = p_a_conductor_id;
  select nombre into v_de_nombre from sgc.usuarios where id = v_uid;
  if v_a_usuario is not null then
    perform sgc.notificar(v_a_usuario, 'transporte',
      'Te ofrecen un conduce',
      format('%s quiere transferirte la responsabilidad de un conduce. Revísalo y acéptalo con foto y firma.',
             coalesce(v_de_nombre,'Un chofer')),
      '/transporte/conduces');
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.ofrecer_transferencia_conduce(uuid,uuid,text) to authenticated;

-- ── 3) Contrato de detalle del conduce para la app (AL9/AL13/AL4) ─────────────
-- Fuente única del DETALLE completo de un conduce para: abrir desde cualquier
-- listado (rows clickables AL9), refrescar tras transferencia (AL13, trae SIEMPRE
-- el portador y estado actual), y alimentar la vista "Ver conduce" (AL4). Incluye
-- el CÓDIGO (derivado del id) e items con nombre/cantidad/unidad para que la app
-- nunca los pierda por render de fila vieja.
create or replace function sgc.conduce_detalle_app(p_salida_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_out jsonb;
  v_puede boolean;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Visibilidad: portador/creador/entregó/recibió, confirmador del destino,
  -- flota/inventario o admin.
  v_puede := sgc.is_admin()
    or v_s.creado_por = auth.uid()
    or v_s.entregado_por = auth.uid()
    or v_s.recibido_por = auth.uid()
    or exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = auth.uid())
    or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or sgc.es_confirmador_de_conduce(p_salida_id);
  if not v_puede then
    raise exception 'No autorizado para ver este conduce.';
  end if;

  select jsonb_build_object(
    'id', v_s.id,
    'numero', 'CND-' || upper(left(v_s.id::text, 8)),
    'fecha', v_s.fecha,
    'created_at', v_s.created_at,
    'estado', v_s.estado,
    'fase', sgc.conduce_fase(v_s.id),
    'motivo', v_s.motivo,
    'proyecto_id', v_s.proyecto_id,
    'proyecto', (select nombre from sgc.proyectos where id = v_s.proyecto_id),
    'bodega_id', v_s.bodega_id,
    'bodega', (select nombre from sgc.bodegas where id = v_s.bodega_id),
    'destino_almacen_id', v_s.destino_almacen_id,
    'destino_almacen', (select nombre from sgc.bodegas where id = v_s.destino_almacen_id),
    -- portador ACTUAL (clave para el refresh AL13)
    'conductor_id', v_s.conductor_id,
    'conductor', (select u.nombre from sgc.conductores c
                    left join sgc.usuarios u on u.id = c.usuario_id
                  where c.id = v_s.conductor_id),
    'creado_por', v_s.creado_por,
    'creado_por_nombre', (select nombre from sgc.usuarios where id = v_s.creado_por),
    'entregado_por', v_s.entregado_por,
    'entregado_por_nombre', (select nombre from sgc.usuarios where id = v_s.entregado_por),
    'entregado_en', v_s.entregado_en,
    'entrega_foto_path', v_s.entrega_foto_path,
    'recibido_por', v_s.recibido_por,
    'recibido_por_nombre', (select nombre from sgc.usuarios where id = v_s.recibido_por),
    'recibido_en', v_s.recibido_en,
    'recepcion_foto_path', v_s.recepcion_foto_path,
    'notas_recepcion', v_s.notas_recepcion,
    'ruta_id', v_s.ruta_id,
    'es_prueba', coalesce(v_s.es_prueba, false),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'detalle_id', d.id,
                'articulo_id', d.articulo_id,
                'articulo', a.nombre,
                'codigo', a.codigo,
                'unidad', a.unidad,
                'propiedad', a.propiedad,
                'cantidad', d.cantidad,
                'cantidad_recibida', d.cantidad_recibida)
                order by a.nombre)
              from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
              where d.salida_id = v_s.id), '[]'::jsonb),
    'firmas', coalesce((select jsonb_agg(jsonb_build_object(
                'rol', sf.rol, 'nombre', sf.nombre, 'firma_path', sf.firma_path, 'firmado_en', sf.firmado_en))
               from sgc.salida_firmas sf where sf.salida_id = v_s.id), '[]'::jsonb),
    'transferencias', coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'estado', t.estado, 'fase_al_transferir', t.fase_al_transferir,
                'de', (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.de_conductor_id),
                'a',  (select u.nombre from sgc.conductores c left join sgc.usuarios u on u.id=c.usuario_id where c.id=t.a_conductor_id),
                'ofrecida_en', t.ofrecida_en, 'resuelta_en', t.resuelta_en)
                order by t.ofrecida_en)
               from sgc.conduce_transferencias t where t.salida_id = v_s.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
grant execute on function sgc.conduce_detalle_app(uuid) to authenticated, service_role;

comment on function sgc.conduce_detalle_app(uuid) is
  'AL9/AL13/AL4 — detalle completo de un conduce (numero derivado, items nombre/cant/unidad, portador ACTUAL, fotos, firmas, historial de transferencias) para abrir desde cualquier listado y refrescar tras transferencia. Visibilidad: portador/creador/entregó/recibió/confirmador/flota/inventario/admin.';

commit;
