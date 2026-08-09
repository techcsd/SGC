-- =============================================================================
-- PROMPT-13 FASE 1 (AJ8) — Estados del conduce operables por el chofer +
-- confirmación EN EL DISPOSITIVO DEL RECEPTOR + fix "pendiente entrega invisible".
-- Ronda 08/08/2026 (IDs AJ). SGC padre. Aditivo, idempotente, retrocompatible.
--
-- Contexto (CONTEXTO-ACTUALIZACION-4 §C AJ8):
--   1) BUG RAÍZ: un conduce recién creado no aparecía en "Pendiente entrega".
--      Causa confirmada contra prod: el chofer de QA (Papo) opera sobre bodegas/
--      proyectos de prueba, así que sus conduces nacen es_prueba=true
--      (es_prueba_origen='heredado' por trigger). `mis_conduces_pendientes_entrega`
--      filtraba `((not es_prueba) or is_admin())` → escondía al chofer sus PROPIOS
--      conduces. El aislamiento es_prueba es para ocultar la prueba AJENA (KPIs /
--      operación real), nunca el trabajo propio del que lo creó. Fix: en el alcance
--      "mis conduces" (ya acotado a conductor_id∈mis o creado_por=yo) NO se filtra
--      es_prueba. Misma corrección en el _count.
--   2) ESTADOS del chofer: emitido → en_transito → entregando → entregado
--      (con foto) → confirmado | pendiente de confirmación. `estado` (stock) sigue
--      siendo la verdad de inventario; se añaden marcas de tiempo transito_at /
--      entregando_at y `conduce_fase` las incorpora (capa de lectura).
--   3) CONFIRMACIÓN EN EL DISPOSITIVO DEL RECEPTOR (regla estricta, valida Xaviel):
--      el chofer solo marca "entregado" con foto; NO firma la recepción en su
--      teléfono. El/los responsables del destino reciben aviso (in-app + push AF7)
--      y confirman (checklist + foto + firma) DESDE SU sesión. Bloqueo server-side
--      anti-suplantación: quien entregó no puede confirmar (salvo admin para QA).
--      Único fallback presencial→remoto: AF15 (registrar_confirmacion_recepcion
--      modo='remota'), intacto.
--   4) Bandeja "entregas por confirmar" por usuario (RPC para la app) + count.
-- =============================================================================

begin;

-- ── 0) Columnas de estado operable del chofer (marcas de tiempo) ─────────────
alter table sgc.salidas_inventario add column if not exists transito_at   timestamptz;
alter table sgc.salidas_inventario add column if not exists entregando_at timestamptz;

comment on column sgc.salidas_inventario.transito_at   is 'AJ8 — el chofer marcó "en tránsito" este conduce.';
comment on column sgc.salidas_inventario.entregando_at is 'AJ8 — el chofer marcó "estoy entregando" este conduce.';

-- ── 1) FIX del "pendiente invisible": no filtrar es_prueba en MIS conduces ────
-- El alcance ya está acotado a los conduces del propio usuario; ver siempre lo
-- propio, sea de prueba o no (feedback_es-prueba-gotchas).
-- (Se dropea para poder re-declarar la firma de columnas con nombres estables.)
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
  where (s.conductor_id in (select sgc.mis_conductor_ids()) or s.creado_por = auth.uid())
    and coalesce(s.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
    and s.recibido_por is null
  order by s.created_at desc;
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega() to authenticated, service_role;

-- _count reusa la lista, así que hereda el fix automáticamente. Se re-declara por
-- claridad (mismo cuerpo).
create or replace function sgc.mis_conduces_pendientes_entrega_count()
returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int from sgc.mis_conduces_pendientes_entrega();
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega_count() to authenticated, service_role;

-- ── 2) conduce_fase: añade 'entregando' y 'en_transito' por marca del chofer ──
-- Prioridad: confirmado > pendiente_firma > entregado (=pendiente de confirmación)
--            > entregando > en_transito > emitido.
create or replace function sgc.conduce_fase(p_salida_id uuid)
returns text
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case
    when s.id is null then null
    when s.recibido_por is not null
      or exists (select 1 from sgc.recepcion_confirmaciones rc
                 where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id=s.id) then 'confirmado'
    when s.firma_pendiente_usuario_id is not null then 'pendiente_firma'
    when s.estado in ('entregado','entregado_incompleto') then 'entregado'
    when s.entregando_at is not null then 'entregando'
    when s.transito_at is not null
      or (p.estado = 'en_camino')
      or exists (select 1 from sgc.rutas r where r.id=s.ruta_id and r.estado='en_curso') then 'en_transito'
    else 'emitido'
  end
  from sgc.salidas_inventario s
  left join sgc.ruta_paradas p on p.id = s.ruta_parada_id
  where s.id = p_salida_id;
$$;
grant execute on function sgc.conduce_fase(uuid) to authenticated, service_role;

-- ── 3) Helper: ¿el usuario actual es el chofer/emisor de este conduce? ────────
create or replace function sgc.es_chofer_de_conduce(p_salida_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.salidas_inventario s
    where s.id = p_salida_id
      and ( s.entregado_por = auth.uid()
            or s.creado_por  = auth.uid()
            or exists (select 1 from sgc.conductores c
                       where c.id = s.conductor_id and c.usuario_id = auth.uid()) )
  );
$$;
grant execute on function sgc.es_chofer_de_conduce(uuid) to authenticated, service_role;

-- ── 4) Helper: usuarios receptores/responsables de un destino (obra o bodega) ─
-- Une responsables del proyecto + empleados del proyecto con cuenta + guarda-
-- almacén con módulo inventario. Se usa para autorizar y para notificar.
create or replace function sgc.receptores_de_destino(p_salida_id uuid)
returns table (usuario_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with s as (select * from sgc.salidas_inventario where id = p_salida_id)
  select pr.usuario_id
    from sgc.proyecto_responsables pr, s
    where pr.proyecto_id = s.proyecto_id and coalesce(pr.activo, true) and pr.usuario_id is not null
  union
  select e.usuario_id
    from sgc.proyecto_empleados pe
    join sgc.empleados e on e.id = pe.empleado_id, s
    where pe.proyecto_id = s.proyecto_id and e.usuario_id is not null
  union
  -- el firmante pendiente designado (recepción dejada pendiente / remota)
  select s.firma_pendiente_usuario_id from s where s.firma_pendiente_usuario_id is not null;
$$;
grant execute on function sgc.receptores_de_destino(uuid) to authenticated, service_role;

-- ── 5) El chofer actualiza el ESTADO de su conduce (en_transito / entregando) ─
create or replace function sgc.conduce_actualizar_estado(p_salida_id uuid, p_estado text)
returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_estado text := lower(coalesce(p_estado,''));
  v_s sgc.salidas_inventario%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_estado not in ('en_transito','entregando') then
    raise exception 'Estado inválido: % (usa en_transito | entregando)', p_estado;
  end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_chofer_de_conduce(p_salida_id)) then
    raise exception 'No eres el conductor asignado a este conduce.';
  end if;
  if v_s.estado <> 'despachado' then
    raise exception 'Este conduce ya fue entregado; no puedes cambiar su estado de tránsito.';
  end if;

  if v_estado = 'en_transito' then
    update sgc.salidas_inventario set transito_at = coalesce(transito_at, now())
      where id = p_salida_id;
    -- refleja el movimiento en la parada/ruta si existen (best-effort).
    if v_s.ruta_parada_id is not null then
      update sgc.ruta_paradas set estado = 'en_camino'
        where id = v_s.ruta_parada_id and estado = 'pendiente';
    end if;
    if v_s.ruta_id is not null then
      update sgc.rutas set estado = 'en_curso', iniciada_at = coalesce(iniciada_at, now())
        where id = v_s.ruta_id and estado = 'planificada';
    end if;
  else -- entregando
    update sgc.salidas_inventario
      set entregando_at = coalesce(entregando_at, now()),
          transito_at   = coalesce(transito_at, now())
      where id = p_salida_id;
  end if;

  return sgc.conduce_fase(p_salida_id);
end;
$$;
grant execute on function sgc.conduce_actualizar_estado(uuid, text) to authenticated, service_role;

-- ── 6) El chofer marca ENTREGADO (foto de entrega) — SIN firma del receptor ───
-- Deja el conduce en "entregado, pendiente de confirmación" y avisa a los
-- receptores del destino para que confirmen desde SU dispositivo.
create or replace function sgc.conduce_marcar_entregado(
  p_salida_id uuid,
  p_foto_path text,
  p_items     jsonb default null,
  p_notas     text  default null
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_item jsonb; v_incompleto boolean; v_r record; v_proy text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotencia: si ya lo entregó este mismo chofer, pasa en silencio.
  if v_s.estado in ('entregado','entregado_incompleto') then
    if v_s.entregado_por = v_uid then return v_s.estado; end if;
    raise exception 'Este conduce ya fue entregado.';
  end if;
  if v_s.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_chofer_de_conduce(p_salida_id)) then
    raise exception 'No eres el conductor asignado a este conduce.';
  end if;

  -- Foto de entrega OBLIGATORIA (AH7). NO se pide firma del receptor aquí (AJ8):
  -- la firma la aporta el receptor desde su propio dispositivo al confirmar.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de entrega es obligatoria para marcar el conduce como entregado.';
  end if;

  -- Reconciliación opcional de cantidades entregadas por el chofer.
  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      update sgc.detalle_salidas
        set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
        where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
    end loop;
  end if;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and cantidad_recibida is not null and cantidad_recibida < cantidad
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado           = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    entregado_por    = v_uid,
    entregado_en     = now(),
    entregando_at    = coalesce(entregando_at, now()),
    transito_at      = coalesce(transito_at, now()),
    entrega_foto_path= coalesce(p_foto_path, entrega_foto_path),
    notas_recepcion  = coalesce(p_notas, notas_recepcion)
    -- recibido_por queda NULL a propósito → pendiente de confirmación del receptor.
  where id = p_salida_id;

  -- Aviso a los receptores del destino (in-app + push AF7). Best-effort.
  select nombre into v_proy from sgc.proyectos where id = v_s.proyecto_id;
  for v_r in select usuario_id from sgc.receptores_de_destino(p_salida_id) loop
    perform sgc.notificar(
      v_r.usuario_id, 'entrega',
      'Tienes una entrega por confirmar',
      'Llegó material a '||coalesce(v_proy,'la obra')||'. Confírmalo desde tu app (checklist, foto y firma).',
      '/transporte/por-confirmar');
  end loop;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$$;
grant execute on function sgc.conduce_marcar_entregado(uuid, text, jsonb, text) to authenticated, service_role;

-- ── 7) El RECEPTOR confirma desde SU sesión (checklist + foto + firma) ────────
-- Anti-suplantación: quien entregó (chofer/emisor) NO puede confirmar, salvo
-- admin (para QA/correcciones). El caller debe ser un receptor autorizado del
-- destino. Genera la entrada de inventario a la bodega de obra (idempotente).
create or replace function sgc.conduce_confirmar_receptor(
  p_salida_id uuid,
  p_foto_path text,
  p_firma_path text,
  p_checklist jsonb default null,
  p_items     jsonb default null,
  p_notas     text  default null
) returns text
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_item jsonb; v_incompleto boolean; v_recibida numeric; v_enviada numeric; v_nombre text;
  v_autorizado boolean; v_bodega_obra_id uuid; v_entrada_id uuid; v_notas text;
  v_receptor_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;
  if v_s.recibido_por is not null then
    raise exception 'Esta entrega ya fue confirmada.';
  end if;

  -- Anti-suplantación (AJ8 estricto): el chofer/emisor no confirma su propia
  -- entrega desde su teléfono (salvo admin). La excepción remota vive en
  -- registrar_confirmacion_recepcion (modo='remota').
  if sgc.es_chofer_de_conduce(p_salida_id) and not sgc.is_admin() then
    raise exception 'La recepción debe confirmarla el responsable del destino desde SU dispositivo, no el transportista.';
  end if;

  -- El caller debe ser receptor autorizado del destino.
  v_autorizado := sgc.is_admin()
    or sgc.puede_confirmar_recepcion()
    or exists (select 1 from sgc.receptores_de_destino(p_salida_id) r where r.usuario_id = v_uid);
  if not v_autorizado then
    raise exception 'No estás autorizado para confirmar la recepción de este destino.';
  end if;

  -- Foto y firma del receptor OBLIGATORIAS.
  if nullif(trim(coalesce(p_foto_path,'')),'') is null then
    raise exception 'La foto de evidencia es obligatoria para confirmar la recepción.';
  end if;
  if nullif(trim(coalesce(p_firma_path,'')),'') is null then
    raise exception 'La firma de recepción es obligatoria.';
  end if;

  -- Reconciliación de cantidades recibidas (validada).
  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_recibida := (v_item->>'cantidad_recibida')::numeric;
      if v_recibida is not null and v_recibida < 0 then
        raise exception 'La cantidad recibida no puede ser negativa.';
      end if;
      select d.cantidad, a.nombre into v_enviada, v_nombre
        from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
        where d.id = (v_item->>'detalle_id')::uuid and d.salida_id = p_salida_id;
      if v_recibida is not null and v_enviada is not null and v_recibida > v_enviada then
        raise exception 'La cantidad recibida (%) de "%" no puede ser mayor que la enviada (%).',
          v_recibida, coalesce(v_nombre,'artículo'), v_enviada;
      end if;
      update sgc.detalle_salidas set cantidad_recibida = v_recibida
        where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
    end loop;
  end if;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  v_notas := concat_ws(' · ', nullif(p_notas,''), 'Confirmado por el receptor en su dispositivo');

  update sgc.salidas_inventario set
    estado             = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por       = v_uid,
    recibido_en        = now(),
    recepcion_foto_path= coalesce(p_foto_path, recepcion_foto_path),
    notas_recepcion    = coalesce(v_notas, notas_recepcion)
  where id = p_salida_id;

  -- Firma del receptor (una por rol) — usuario_id forzado a la sesión. Se escribe
  -- directo en salida_firmas: el caller ya quedó autorizado como receptor arriba,
  -- y firmar_conduce re-validaría con reglas de flota/inventario que un simple
  -- responsable de obra no cumple.
  select nombre into v_receptor_nombre from sgc.usuarios where id = v_uid;
  delete from sgc.salida_firmas where salida_id = p_salida_id and rol = 'receptor';
  insert into sgc.salida_firmas (salida_id, rol, nombre, usuario_id, firma_path, metodo, firmado_en)
  values (p_salida_id, 'receptor', coalesce(v_receptor_nombre,'Receptor'), v_uid, p_firma_path, 'pad', now());

  -- Log de evidencia (checklist + foto) atado a la sesión del receptor.
  insert into sgc.recepcion_confirmaciones (
    entidad_tipo, entidad_id, confirmado_por, modo, fotos, notas, checklist,
    es_prueba, es_prueba_origen
  ) values (
    'salida', p_salida_id, v_uid, 'presencial', array[p_foto_path], p_notas, p_checklist,
    coalesce(v_s.es_prueba, false), case when coalesce(v_s.es_prueba,false) then 'heredado' else 'manual' end
  );

  -- Entrada de inventario a la bodega de obra (si aplica y aún no existe).
  if v_s.proyecto_id is not null then
    select id into v_bodega_obra_id from sgc.bodegas where proyecto_id = v_s.proyecto_id limit 1;
    if v_bodega_obra_id is not null and v_bodega_obra_id <> v_s.bodega_id
       and not exists (select 1 from sgc.entradas_inventario where salida_id = p_salida_id) then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, salida_id
      ) values (
        current_date, v_bodega_obra_id, 'Recepción de material despachado a la obra',
        v_notas, v_uid, 'recepcion_obra', v_s.proyecto_id, p_salida_id
      ) returning id into v_entrada_id;
      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
        from sgc.detalle_salidas d
        where d.salida_id = p_salida_id and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  -- Avisa al chofer que su entrega fue confirmada.
  if coalesce(v_s.entregado_por, v_s.conductor_id) is not null and v_s.creado_por is not null then
    perform sgc.notificar(v_s.creado_por, 'entrega',
      'Entrega confirmada',
      'El receptor confirmó la recepción de tu conduce.',
      '/transporte/mis-conduces');
  end if;

  return sgc.conduce_fase(p_salida_id);
end;
$$;
grant execute on function sgc.conduce_confirmar_receptor(uuid, text, text, jsonb, jsonb, text) to authenticated, service_role;

-- ── 8) Bandeja "entregas por confirmar" del usuario (app) + count ────────────
drop function if exists sgc.mis_entregas_por_confirmar_count();
drop function if exists sgc.mis_entregas_por_confirmar();
create or replace function sgc.mis_entregas_por_confirmar()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, entregado_en timestamptz, entrega_foto_path text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id, p.nombre, b.nombre, s.estado,
         sgc.conduce_fase(s.id), s.entregado_en, s.entrega_foto_path
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  where s.estado in ('entregado','entregado_incompleto')
    and s.recibido_por is null
    and not exists (select 1 from sgc.recepcion_confirmaciones rc
                    where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = s.id)
    and not (sgc.es_chofer_de_conduce(s.id) and not sgc.is_admin())  -- el que entregó no confirma
    and (
      sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or exists (select 1 from sgc.receptores_de_destino(s.id) r where r.usuario_id = auth.uid())
    )
  order by s.entregado_en desc nulls last, s.created_at desc;
$$;
grant execute on function sgc.mis_entregas_por_confirmar() to authenticated, service_role;

create or replace function sgc.mis_entregas_por_confirmar_count()
returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int from sgc.mis_entregas_por_confirmar();
$$;
grant execute on function sgc.mis_entregas_por_confirmar_count() to authenticated, service_role;

commit;
