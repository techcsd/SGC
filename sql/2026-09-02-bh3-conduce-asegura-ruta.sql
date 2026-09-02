-- ════════════════════════════════════════════════════════════════════════════
-- BH3 — Cuando un conduce llega al chofer, la ruta se crea sola.
--
-- Un SOLO punto de creación (AU1): conduce_asegurar_ruta(p_salida_id) que, dado un
-- conduce CON conductor asignado, cree-o-reutilice la ruta del día de ese chofer
-- con origen/destino derivados del conduce (bodega_id / destino_almacen_id /
-- proyecto_id / destino_texto — el mismo coalesce de planificar_solicitud_con_ruta),
-- su parada del destino con los renglones en `notas`, y el enlace ruta_id/ruta_parada_id.
-- IDEMPOTENTE (si el conduce ya tiene ruta, no duplica) — un reintento del outbox
-- (que ahora reintenta más, BG1) no puede crear rutas de más.
--
-- 🔴 DECISIÓN DE XAVIEL (la de plata): la ruta derivada de un conduce NO puntúa el
-- renglón `ruta` del incentivo — el trabajo es UNO; la ruta es la representación
-- logística del mismo hecho, no un segundo hecho. Se marca con derivada_de_conduce
-- y incentivo_generar_semana la excluye del renglón `ruta`. (Evita el doble pago:
-- conduce + ruta por el mismo viaje; recuerdo de los 30 viajes fantasma de Joan.)
--
-- Con esto muere la deuda de AM5 ("creé el conduce y no sale en ruta").
-- Regla 2 del checklist: columna NOT NULL nueva ⇒ default en la misma migración.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- (1) Marca de "ruta derivada de un conduce" (NOT NULL con default). ──────────
alter table sgc.rutas
  add column if not exists derivada_de_conduce boolean not null default false;
comment on column sgc.rutas.derivada_de_conduce is
  'BH3 — la ruta nació automáticamente de un conduce con chofer. NO puntúa el renglón '
  '`ruta` del incentivo (el conduce ya paga ese viaje). Decisión Xaviel.';

-- (2) El único punto de creación: crea-o-reutiliza la ruta del día del chofer. ─
create or replace function sgc.conduce_asegurar_ruta(p_salida_id uuid)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_cond_id uuid; v_cond_usuario uuid;
  v_ruta uuid; v_origen text; v_destino text;
  v_orden int; v_parada uuid; v_desc text;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Sin chofer no hay ruta que asegurar (no-op). Idempotente: si ya tiene ruta,
  -- se devuelve la existente sin crear otra (protege de reintentos del outbox).
  if v_s.conductor_id is null then return v_s.ruta_id; end if;
  if v_s.ruta_id is not null then return v_s.ruta_id; end if;

  v_cond_id := v_s.conductor_id;
  select usuario_id into v_cond_usuario from sgc.conductores where id = v_cond_id;

  -- Origen/destino por coalesce (mismo patrón que planificar_solicitud_con_ruta).
  v_origen  := coalesce((select nombre from sgc.bodegas where id = v_s.bodega_id), 'Origen');
  v_destino := coalesce(nullif(v_s.destino_texto, ''),
                        (select nombre from sgc.bodegas   where id = v_s.destino_almacen_id),
                        (select nombre from sgc.proyectos where id = v_s.proyecto_id),
                        'Destino');

  -- Descripción de la parada armada con los renglones (el "4 PINO DE MADERA").
  select string_agg(x.linea, ', ') into v_desc from (
    select trim(coalesce(ds.cantidad::text || ' ', '') || a.nombre) as linea
      from sgc.detalle_salidas ds join sgc.articulos a on a.id = ds.articulo_id
     where ds.salida_id = p_salida_id
    union all
    select trim(coalesce(il.cantidad::text || ' ', '') || il.nombre)
      from sgc.salida_items_libres il
     where il.salida_id = p_salida_id and il.declinado_at is null
  ) x;

  -- Reutiliza la ruta en curso del día del chofer; si no hay, crea una derivada.
  select id into v_ruta from sgc.rutas
   where conductor_id = v_cond_id and estado = 'en_curso' and fecha = current_date
   order by iniciada_at desc nulls last limit 1;

  if v_ruta is null then
    insert into sgc.rutas (vehiculo_id, conductor_id, origen, destino, destino_proyecto_id,
                           fecha, tipo, estado, creado_por, es_prueba, derivada_de_conduce, notas)
    values (v_s.vehiculo_id, v_cond_id, v_origen, v_destino, v_s.proyecto_id,
            coalesce(v_s.fecha, current_date), 'material', 'planificada', auth.uid(),
            coalesce(v_s.es_prueba, false), true,
            'Ruta derivada del conduce CND-' || upper(left(p_salida_id::text, 8)))
    returning id into v_ruta;
  end if;

  select coalesce(max(orden), 0) + 1 into v_orden from sgc.ruta_paradas where ruta_id = v_ruta;
  insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, proyecto_id, estado, notas)
  values (v_ruta, v_orden, v_destino, v_s.proyecto_id, 'pendiente', v_desc)
  returning id into v_parada;

  update sgc.salidas_inventario
     set ruta_id = v_ruta, ruta_parada_id = v_parada
   where id = p_salida_id;

  -- Avisar al chofer (como ya hace la solicitud de movimiento).
  if v_cond_usuario is not null and v_cond_usuario <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    perform sgc.notificar(v_cond_usuario, 'transporte', 'Nueva ruta asignada',
      format('Conduce %s: %s → %s.', 'CND-' || upper(left(p_salida_id::text, 8)), v_origen, v_destino),
      '/flota/rutas');
  end if;

  return v_ruta;
end;
$function$;
grant execute on function sgc.conduce_asegurar_ruta(uuid) to authenticated, service_role;

-- (3) La aceptación de transferencia también ASEGURA la ruta (antes solo reasignaba
--     si ya existía). Se llama al final, tras reasignar el conductor.
create or replace function sgc.aceptar_transferencia_conduce(p_transferencia_id uuid, p_foto_path text, p_firma_path text)
 returns uuid
 language plpgsql security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t sgc.conduce_transferencias%rowtype;
  v_salida sgc.salidas_inventario%rowtype;
  v_soy_destino boolean; v_ofrecio uuid; v_a_nombre text;
  v_receptor_usuario uuid; v_codigo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_t from sgc.conduce_transferencias where id = p_transferencia_id for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_t.estado <> 'ofrecida' then
    if v_t.estado = 'aceptada' and v_t.aceptada_por = v_uid then return v_t.id; end if; -- idempotente
    raise exception 'Esta transferencia ya fue resuelta';
  end if;

  v_soy_destino := exists (select 1 from sgc.conductores c
                           where c.id = v_t.a_conductor_id and c.usuario_id = v_uid);
  if not v_soy_destino then raise exception 'Solo el chofer destino puede aceptar la transferencia'; end if;

  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de recepción es obligatoria para aceptar la transferencia';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma del receptor es obligatoria para aceptar la transferencia';
  end if;

  select * into v_salida from sgc.salidas_inventario where id = v_t.salida_id for update;

  update sgc.conduce_transferencias
     set estado = 'aceptada', aceptada_por = v_uid, foto_path = p_foto_path,
         firma_path = p_firma_path, resuelta_en = now()
   where id = p_transferencia_id;

  perform set_config('sgc.portador_ok', 'on', true);
  update sgc.salidas_inventario set conductor_id = v_t.a_conductor_id where id = v_t.salida_id;

  -- BH3 — si había ruta, se reasigna; si NO había, se crea (conduce_asegurar_ruta).
  if v_salida.ruta_id is not null then
    update sgc.rutas set conductor_id = v_t.a_conductor_id, updated_at = now()
     where id = v_salida.ruta_id;
  else
    perform sgc.conduce_asegurar_ruta(v_t.salida_id);
  end if;

  v_codigo := 'CND-' || upper(left(v_t.salida_id::text, 8));
  select nombre into v_a_nombre from sgc.usuarios where id = v_uid;

  v_ofrecio := coalesce(v_t.ofrecida_por,
                        (select usuario_id from sgc.conductores where id = v_t.de_conductor_id));
  if v_ofrecio is not null and v_ofrecio <> v_uid then
    perform sgc.notificar(v_ofrecio, 'transporte',
      'Transferencia de conduce aceptada',
      format('%s aceptó la responsabilidad del conduce %s. Ya no está en tu bandeja.',
             coalesce(v_a_nombre,'El chofer'), v_codigo),
      '/transporte/conduces');
  end if;

  select usuario_id into v_receptor_usuario from sgc.conductores where id = v_t.a_conductor_id;
  if v_receptor_usuario is not null and v_receptor_usuario <> v_ofrecio then
    perform sgc.notificar(v_receptor_usuario, 'transporte',
      'Conduce a tu cargo',
      format('Aceptaste el conduce %s. Ya está en tu Pendiente entrega.', v_codigo),
      '/transporte/conduces');
  end if;

  return v_t.id;
end;
$function$;

commit;
