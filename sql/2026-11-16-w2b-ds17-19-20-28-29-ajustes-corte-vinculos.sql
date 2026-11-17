-- W2b (ronda DS, 16-nov-2026): cierra lo parcial de backend de DS-17, DS-19, DS-20, DS-28 y DS-29. ADITIVA; solo dev (regla 18/19).
-- Todo sigue APAGADO: las solicitudes automaticas solo nacen con la politica `salida_inventario` habilitada, el evento
-- `ajuste_faltante` solo se reclama con su propia politica habilitada, y el bloqueo de stock solo actua en bodegas con `fuente_odoo`.
--  DS-17  solicitud de ajuste por faltante nace sola al entregar incompleto (ADR 5); rechazar devuelve el stock al origen en SGC y
--         encola la devolucion transito -> origen en Odoo; aprobar encola la baja desde transito.
--  DS-19  prueba -> real exige autorizacion de admin (con motivo) cuando ese tipo de documento ya publica a Odoo.
--  DS-20  evaluador de vinculo de material libre (unidades incompatibles / coincidencia ambigua) con mensaje claro; vincular lo aplica.
--  DS-28  PDF firmado del conduce (ruta en storage) y estado de sync de cada solicitud de ajuste.
--  DS-29  apertura por bodega (preparar/marcar) y bloqueo de escrituras directas a stock_por_bodega en bodegas con fuente Odoo.

-- ── DS-28: columnas de sync de la solicitud de ajuste + ruta del PDF firmado ───────────────────────────────────────────────
alter table sgc.odoo_solicitudes_ajuste
  add column if not exists odoo_instancia_id uuid,
  add column if not exists odoo_picking_id bigint,
  add column if not exists odoo_sync_estado text,
  add column if not exists odoo_sync_error text,
  add column if not exists odoo_sync_en timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'odoo_ajuste_sync_estado_chk' and conrelid = 'sgc.odoo_solicitudes_ajuste'::regclass) then
    alter table sgc.odoo_solicitudes_ajuste add constraint odoo_ajuste_sync_estado_chk check (odoo_sync_estado is null or odoo_sync_estado in ('pendiente', 'sincronizado', 'incierto', 'error'));
  end if;
end $$;

-- PDF firmado del conduce: el cliente lo sube al bucket `conduces` (salida/<id>/...) y registra la ruta; el worker lo adjunta al picking.
alter table sgc.salidas_inventario add column if not exists pdf_firmado_path text;

create or replace function sgc.salida_pdf_firmado_registrar(p_salida uuid, p_path text)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_s sgc.salidas_inventario%rowtype;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida;
  if not found then raise exception 'Conduce no encontrado.' using errcode = '22023'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or v_s.creado_por = auth.uid() or v_s.entregado_por = auth.uid()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_path is null or p_path !~ ('^salida/' || p_salida::text || '/[A-Za-z0-9._-]+\.pdf$') then
    raise exception 'La ruta del PDF no corresponde a este conduce.' using errcode = '22023';
  end if;
  update sgc.salidas_inventario set pdf_firmado_path = p_path where id = p_salida;
end $fn$;

-- ── Tipo de evento nuevo `ajuste_faltante` (se agrega a la lista vigente, sin perder las que otros hayan sumado) ─────────────
do $$
declare v_c text; v_def text; v_lista text;
begin
  select conname, pg_get_constraintdef(oid) into v_c, v_def from pg_constraint
   where conrelid = 'sgc.odoo_eventos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%agregado_tipo%' limit 1;
  if v_c is null then raise exception 'No se encontró el CHECK de agregado_tipo en odoo_eventos.'; end if;
  if v_def like '%ajuste_faltante%' then return; end if;
  v_lista := substring(v_def from '\{([^}]*)\}');
  if v_lista is null then raise exception 'No se pudo leer la lista de tipos de evento: %', v_def; end if;
  execute format('alter table sgc.odoo_eventos drop constraint %I', v_c);
  execute format('alter table sgc.odoo_eventos add constraint %I check (agregado_tipo = any (%L::text[]))', v_c, '{' || v_lista || ',ajuste_faltante}');
end $$;

-- ── DS-17: solicitud de ajuste por faltante integrada al flujo de recepcion ─────────────────────────────────────────────────
-- Nucleo sin gate de usuario: lo llama el trigger de recepcion incompleta y el RPC publico.
create or replace function sgc._odoo_ajuste_crear(p_salida uuid)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  insert into sgc.odoo_solicitudes_ajuste (salida_id, articulo_id, faltante)
  select d.salida_id, d.articulo_id, d.cantidad - d.cantidad_recibida
    from sgc.detalle_salidas d join sgc.salidas_inventario s on s.id = d.salida_id
   where d.salida_id = p_salida and s.estado = 'entregado_incompleto' and coalesce(s.es_prueba, false) = false
     and d.cantidad_recibida is not null and d.cantidad_recibida < d.cantidad
  on conflict (salida_id, articulo_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform sgc.notificar_modulo('inventario', 'alerta', 'Faltante por resolver', 'Un conduce llegó incompleto: aprueba el ajuste o devuelve el material desde tránsito.', '/tecnologia/odoo-ajustes');
  end if;
  return v_n;
end $fn$;
revoke all on function sgc._odoo_ajuste_crear(uuid) from public, anon, authenticated;

create or replace function sgc.odoo_ajuste_solicitar(p_salida uuid)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (auth.role() = 'service_role' or sgc.is_admin() or sgc.tiene_modulo('inventario')) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  return sgc._odoo_ajuste_crear(p_salida);
end $fn$;

-- La solicitud nace al CONFIRMAR la transaccion de la recepcion incompleta (cantidad_recibida ya escrita), pero solo si ese tipo de
-- documento ya publica a Odoo: con la politica apagada no hay faltante "en transito en Odoo" que resolver.
create or replace function sgc.tg_odoo_ajuste_faltante()
returns trigger language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if exists (select 1 from sgc.odoo_publicacion_politica where agregado_tipo = 'salida_inventario' and habilitada) then
    perform sgc._odoo_ajuste_crear(new.id);
  end if;
  return null;
end $fn$;
drop trigger if exists tg_odoo_ajuste_faltante on sgc.salidas_inventario;
create constraint trigger tg_odoo_ajuste_faltante after update of estado on sgc.salidas_inventario
  deferrable initially deferred for each row
  when (new.estado = 'entregado_incompleto' and old.estado is distinct from new.estado)
  execute function sgc.tg_odoo_ajuste_faltante();

-- Encola la ejecucion en Odoo (un evento por decision). Misma regla que el resto: solo con UNA instancia habilitada.
create or replace function sgc._odoo_ajuste_encolar(p_id uuid)
returns uuid language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid; v_n integer; v_rev integer; v_a sgc.odoo_solicitudes_ajuste%rowtype; v_prueba boolean; v_id uuid;
begin
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return null; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  select * into v_a from sgc.odoo_solicitudes_ajuste where id = p_id;
  if not found then return null; end if;
  select coalesce(es_prueba, false) into v_prueba from sgc.salidas_inventario where id = v_a.salida_id;
  select coalesce(max(revision), 0) + 1 into v_rev from sgc.odoo_eventos where agregado_tipo = 'ajuste_faltante' and agregado_id = p_id::text;
  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_inst, 'ajuste_faltante', p_id::text, 'actualizar', v_rev, to_jsonb(v_a), coalesce(v_prueba, false))
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing returning id into v_id;
  return v_id;
end $fn$;
revoke all on function sgc._odoo_ajuste_encolar(uuid) from public, anon, authenticated;

create or replace function sgc.odoo_ajuste_decidir(p_id uuid, p_aprobar boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_a sgc.odoo_solicitudes_ajuste%rowtype; v_bodega uuid;
begin
  -- Jefe de inventario (modulo inventario, sin ser guardalmacen) o admin; quien despacho no se aprueba solo.
  if not (sgc.is_admin() or (sgc.tiene_modulo('inventario') and not exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id where ur.usuario_id = auth.uid() and r.codigo = 'guarda_almacen'))) then
    raise exception 'Solo el jefe de inventario o un administrador puede resolver un faltante.' using errcode = '42501';
  end if;
  if not p_aprobar and length(btrim(coalesce(p_nota, ''))) < 10 then raise exception 'Para rechazar indica el motivo (mínimo 10 caracteres).' using errcode = '22023'; end if;
  update sgc.odoo_solicitudes_ajuste
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         accion = case when p_aprobar then 'ajuste' else 'devolver_transito' end,
         decidida_por = auth.uid(), decidida_en = now(), nota = nullif(btrim(coalesce(p_nota, '')), ''),
         odoo_sync_estado = 'pendiente', odoo_sync_error = null
   where id = p_id and estado = 'pendiente'
  returning * into v_a;
  if not found then raise exception 'La solicitud no existe o ya fue resuelta.' using errcode = '22023'; end if;
  -- Rechazo = el material NO se perdio: vuelve al origen. SGC ya lo habia descontado al despachar, asi que se devuelve aqui (una sola vez:
  -- el UPDATE de arriba solo prospera con la solicitud pendiente). Si la bodega ya usa Odoo como fuente, el stock lo proyecta Odoo.
  if not p_aprobar then
    select bodega_id into v_bodega from sgc.salidas_inventario where id = v_a.salida_id;
    if v_bodega is not null and sgc.odoo_movimiento_permitido(v_bodega, false) then
      perform sgc.adjust_stock(v_a.articulo_id, v_bodega, v_a.faltante);
    end if;
  end if;
  perform sgc._odoo_ajuste_encolar(p_id);
  begin
    insert into sgc.auditoria (tabla, registro_id, accion, actor_id, datos_despues)
    values ('odoo_solicitudes_ajuste', p_id, case when p_aprobar then 'faltante_aprobado' else 'faltante_rechazado' end, auth.uid(),
            jsonb_build_object('salida_id', v_a.salida_id, 'articulo_id', v_a.articulo_id, 'faltante', v_a.faltante, 'nota', v_a.nota));
  exception when others then null; -- la auditoria no tumba la decision
  end;
end $fn$;

create or replace function sgc.odoo_v1_marcar_ajuste_sync(p_id uuid, p_instancia uuid, p_picking bigint, p_estado text, p_error text default null)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (auth.role() = 'service_role' or sgc.is_admin()) then raise exception 'Solo service_role o admin puede marcar la sincronizacion' using errcode = '42501'; end if;
  if p_estado not in ('pendiente', 'sincronizado', 'incierto', 'error') then raise exception 'estado invalido: %', p_estado; end if;
  update sgc.odoo_solicitudes_ajuste
     set odoo_instancia_id = coalesce(p_instancia, odoo_instancia_id), odoo_picking_id = coalesce(p_picking, odoo_picking_id),
         odoo_sync_estado = p_estado, odoo_sync_error = case when p_estado = 'sincronizado' and p_error is null then null else p_error end, odoo_sync_en = now()
   where id = p_id;
end $fn$;

-- Lo que la pantalla necesita (AT11: todo lo enviado se ve). Folio derivado como en el resto del sistema.
create or replace function sgc.odoo_ajustes_listado()
returns table (id uuid, salida_id uuid, folio text, articulo text, faltante numeric, estado text, accion text, nota text, creada_en timestamptz,
               decidida_en timestamptz, odoo_sync_estado text, odoo_sync_error text, odoo_picking_id bigint)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_tecnologia()) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  return query
    select a.id, a.salida_id, 'CND-' || upper(substr(a.salida_id::text, 1, 8)), ar.nombre::text, a.faltante, a.estado, a.accion, a.nota, a.creada_en,
           a.decidida_en, a.odoo_sync_estado, a.odoo_sync_error, a.odoo_picking_id
      from sgc.odoo_solicitudes_ajuste a join sgc.articulos ar on ar.id = a.articulo_id
     order by (a.estado = 'pendiente') desc, a.creada_en desc limit 300;
end $fn$;

-- ── DS-19: prueba -> real exige autorizacion de admin si ese tipo ya publica a Odoo ──────────────────────────────────────────
create table if not exists sgc.odoo_prueba_real_autorizaciones (
  id uuid primary key default gen_random_uuid(),
  tabla text not null check (tabla in ('salidas_inventario', 'entradas_inventario', 'retiros_material', 'conduces_externos', 'conteos_inventario')),
  registro_id uuid not null,
  motivo text not null check (length(btrim(motivo)) >= 10),
  autorizada_por uuid not null,
  autorizada_en timestamptz not null default now(),
  vigente_hasta timestamptz not null,
  usada_en timestamptz
);
create index if not exists odoo_prueba_real_aut_ix on sgc.odoo_prueba_real_autorizaciones (tabla, registro_id) where usada_en is null;
alter table sgc.odoo_prueba_real_autorizaciones enable row level security;
drop policy if exists odoo_prueba_real_aut_sel on sgc.odoo_prueba_real_autorizaciones;
create policy odoo_prueba_real_aut_sel on sgc.odoo_prueba_real_autorizaciones for select to authenticated using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.odoo_prueba_real_autorizaciones to authenticated;
grant all on sgc.odoo_prueba_real_autorizaciones to service_role;

create or replace function sgc.odoo_prueba_real_autorizar(p_tabla text, p_id uuid, p_motivo text, p_horas integer default 2)
returns uuid language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_ok boolean; v_id uuid;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede autorizar que un documento de prueba pase a real.' using errcode = '42501'; end if;
  if p_tabla not in ('salidas_inventario', 'entradas_inventario', 'retiros_material', 'conduces_externos', 'conteos_inventario') then
    raise exception 'Tabla no permitida: %', p_tabla using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Indica el motivo (mínimo 10 caracteres).' using errcode = '22023'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 24 then raise exception 'La autorización dura entre 1 y 24 horas.' using errcode = '22023'; end if;
  execute format('select coalesce(es_prueba, false) from sgc.%I where id = $1', p_tabla) into v_ok using p_id;
  if v_ok is null then raise exception 'El documento no existe.' using errcode = '22023'; end if;
  if not v_ok then raise exception 'El documento ya es real: no hace falta autorizar.' using errcode = '22023'; end if;
  insert into sgc.odoo_prueba_real_autorizaciones (tabla, registro_id, motivo, autorizada_por, vigente_hasta)
    values (p_tabla, p_id, btrim(p_motivo), auth.uid(), now() + make_interval(hours => p_horas)) returning id into v_id;
  return v_id;
end $fn$;

create or replace function sgc.tg_odoo_prueba_a_real()
returns trigger language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_tipo text; v_aut uuid;
begin
  v_tipo := case tg_table_name when 'salidas_inventario' then 'salida_inventario' when 'entradas_inventario' then 'entrada_inventario'
    when 'retiros_material' then 'retiro_material' when 'conduces_externos' then 'conduce_externo' when 'conteos_inventario' then 'conteo_inventario' end;
  -- Sin politica habilitada para este tipo no hay efecto en Odoo: el cambio es libre (comportamiento de siempre).
  if not exists (select 1 from sgc.odoo_publicacion_politica where agregado_tipo = v_tipo and habilitada) then return new; end if;
  update sgc.odoo_prueba_real_autorizaciones set usada_en = now()
   where id = (select id from sgc.odoo_prueba_real_autorizaciones where tabla = tg_table_name and registro_id = new.id and usada_en is null and vigente_hasta > now()
               order by autorizada_en desc limit 1 for update)
  returning id into v_aut;
  if v_aut is null then
    raise exception 'Este documento de prueba pasaría a real y publicaría un movimiento real en Odoo. Un administrador debe autorizarlo primero (con el motivo).' using errcode = 'P0001';
  end if;
  return new;
end $fn$;

do $$ declare t text; begin
  foreach t in array array['salidas_inventario', 'entradas_inventario', 'retiros_material', 'conduces_externos', 'conteos_inventario'] loop
    execute format('drop trigger if exists tg_odoo_prueba_a_real on sgc.%I', t);
    execute format('create trigger tg_odoo_prueba_a_real before update of es_prueba on sgc.%I for each row when (old.es_prueba is true and new.es_prueba is not true) execute function sgc.tg_odoo_prueba_a_real()', t);
  end loop;
end $$;

-- ── DS-20: evaluador del vinculo material libre -> articulo (unidades incompatibles / coincidencia ambigua) ─────────────────
create or replace function sgc.unidad_familia(p text)
returns text language sql immutable set search_path = sgc, pg_temp as $fn$
  select case lower(btrim(coalesce(p, '')))
    when '' then null
    when 'u' then 'conteo' when 'ud' then 'conteo' when 'und' then 'conteo' when 'unidad' then 'conteo' when 'unidades' then 'conteo' when 'pza' then 'conteo'
    when 'pieza' then 'conteo' when 'par' then 'conteo' when 'juego' then 'conteo'
    when 'saco' then 'envase' when 'sacos' then 'envase' when 'caja' then 'envase' when 'paquete' then 'envase' when 'resma' then 'envase' when 'rollo' then 'envase'
    when 'gl' then 'liquido' when 'gal' then 'liquido' when 'galon' then 'liquido' when 'l' then 'liquido' when 'lt' then 'liquido' when 'litro' then 'liquido'
    when 'm3' then 'volumen' when 'm³' then 'volumen'
    when 'lb' then 'peso' when 'kg' then 'peso' when 'qq' then 'peso' when 'ton' then 'peso'
    when 'pie' then 'longitud' when 'pies' then 'longitud' when 'm' then 'longitud' when 'ml' then 'longitud' when 'pulg' then 'longitud' when 'm2' then 'longitud'
    else null end
$fn$;

-- Devuelve {ok, codigo, mensaje, unidad_libre, unidad_articulo, candidatos[]}. codigo: ok | sin_coincidencia | ambigua | unidades_incompatibles | ya_vinculado | no_encontrado
create or replace function sgc.odoo_vinculo_libre_evaluar(p_item_libre_id uuid, p_articulo_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = sgc, extensions, public, pg_temp as $fn$
declare
  v_il sgc.salida_items_libres%rowtype; v_art sgc.articulos%rowtype; v_fl text; v_fa text; v_cand jsonb; v_n integer; v_s1 numeric; v_s2 numeric;
begin
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  select * into v_il from sgc.salida_items_libres where id = p_item_libre_id;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'no_encontrado', 'mensaje', 'El material no existe.'); end if;
  if v_il.articulo_vinculado_id is not null then return jsonb_build_object('ok', false, 'codigo', 'ya_vinculado', 'mensaje', 'Este material ya fue vinculado.'); end if;
  v_fl := sgc.unidad_familia(v_il.unidad);

  if p_articulo_id is not null then
    select * into v_art from sgc.articulos where id = p_articulo_id;
    if not found then return jsonb_build_object('ok', false, 'codigo', 'no_encontrado', 'mensaje', 'Artículo no encontrado.'); end if;
    v_fa := sgc.unidad_familia(v_art.unidad);
    if v_fl is not null and v_fa is not null and v_fl <> v_fa then
      return jsonb_build_object('ok', false, 'codigo', 'unidades_incompatibles', 'unidad_libre', v_il.unidad, 'unidad_articulo', v_art.unidad,
        'mensaje', format('El material «%s» viene en «%s» y el artículo «%s» se maneja en «%s»: no son equivalentes. Elige un artículo con la misma unidad o crea uno nuevo.',
                          v_il.nombre, v_il.unidad, v_art.nombre, v_art.unidad));
    end if;
    return jsonb_build_object('ok', true, 'codigo', 'ok', 'unidad_libre', v_il.unidad, 'unidad_articulo', v_art.unidad, 'mensaje', null);
  end if;

  -- Sin articulo elegido: ¿hay una coincidencia clara o varias parecidas? (ambiguo = NO se vincula solo, queda pendiente con explicacion)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'codigo', x.codigo, 'nombre', x.nombre, 'unidad', x.unidad, 'similitud', x.sim,
           'compatible', (v_fl is null or sgc.unidad_familia(x.unidad) is null or sgc.unidad_familia(x.unidad) = v_fl)) order by x.sim desc), '[]'::jsonb),
         count(*) filter (where x.sim >= 0.6), max(x.sim), (array_agg(x.sim order by x.sim desc))[2]
    into v_cand, v_n, v_s1, v_s2
    from (select a.id, a.codigo, a.nombre, a.unidad, round(similarity(sgc.f_unaccent(lower(a.nombre)), sgc.f_unaccent(lower(v_il.nombre)))::numeric, 2) sim
            from sgc.articulos a where a.activo and coalesce(a.es_prueba, false) = false
             and similarity(sgc.f_unaccent(lower(a.nombre)), sgc.f_unaccent(lower(v_il.nombre))) >= 0.45
           order by 5 desc limit 5) x;
  if jsonb_array_length(v_cand) = 0 then
    return jsonb_build_object('ok', true, 'codigo', 'sin_coincidencia', 'candidatos', v_cand, 'mensaje', 'No hay artículos parecidos: puedes crear uno nuevo.');
  end if;
  if v_n >= 2 and (v_s1 - coalesce(v_s2, 0)) < 0.1 then
    return jsonb_build_object('ok', false, 'codigo', 'ambigua', 'candidatos', v_cand,
      'mensaje', format('Hay %s artículos muy parecidos a «%s»: elige cuál es. No se vincula solo para no mezclar existencias.', v_n, v_il.nombre));
  end if;
  return jsonb_build_object('ok', true, 'codigo', 'ok', 'candidatos', v_cand, 'mensaje', null);
end $fn$;

-- vincular: misma firma que BW2; ahora rechaza con mensaje claro cuando las unidades son incompatibles.
create or replace function sgc.vincular_item_libre_articulo(p_item_libre_id uuid, p_articulo_id uuid, p_generar_movimiento boolean default false)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
declare
  v_il sgc.salida_items_libres%rowtype; v_s sgc.salidas_inventario%rowtype; v_ev jsonb;
begin
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.articulos where id = p_articulo_id) then
    raise exception 'Artículo no encontrado.';
  end if;
  select * into v_il from sgc.salida_items_libres where id = p_item_libre_id;
  if not found then raise exception 'Item libre no encontrado.'; end if;
  if v_il.articulo_vinculado_id is not null then
    raise exception 'Este material ya fue vinculado.';
  end if;
  -- DS-20: unidades incompatibles = no se vincula (la ambigüedad de nombres no aplica: aquí el usuario ya eligió el artículo).
  v_ev := sgc.odoo_vinculo_libre_evaluar(p_item_libre_id, p_articulo_id);
  if v_ev ->> 'codigo' = 'unidades_incompatibles' then raise exception '%', v_ev ->> 'mensaje' using errcode = '22023'; end if;

  update sgc.salida_items_libres
     set articulo_vinculado_id = p_articulo_id, vinculado_at = now(), vinculado_por = auth.uid()
   where id = p_item_libre_id;

  if coalesce(p_generar_movimiento, false) then
    select * into v_s from sgc.salidas_inventario where id = v_il.salida_id;
    if v_s.bodega_id is null then
      raise exception 'El conduce no tiene bodega de origen; no se puede generar el movimiento.';
    end if;
    insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad) values (v_il.salida_id, p_articulo_id, v_il.cantidad);
    perform sgc.adjust_stock(p_articulo_id, v_s.bodega_id, -v_il.cantidad);
    begin
      insert into sgc.auditoria(tabla, registro_id, accion, actor_id, datos_despues)
      values ('salida_items_libres', p_item_libre_id, 'vincular_con_movimiento', auth.uid(),
              jsonb_build_object('articulo_id', p_articulo_id, 'cantidad', v_il.cantidad, 'bodega_id', v_s.bodega_id, 'salida_id', v_il.salida_id));
    exception when others then null;
    end;
  end if;
end;
$$;

-- ── DS-29: apertura por bodega + bloqueo de escrituras directas con fuente Odoo ──────────────────────────────────────────────
alter table sgc.odoo_corte_bodega
  add column if not exists apertura_en timestamptz,
  add column if not exists apertura_resultado jsonb,
  add column if not exists apertura_error text;

-- Datos de la apertura (solo service_role): la fase corte, la fecha, la ubicacion y los saldos SGC de los articulos HOMOLOGADOS con fila de stock.
create or replace function sgc.odoo_corte_apertura_preparar(p_bodega uuid)
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_b sgc.bodegas%rowtype; v_c sgc.odoo_corte_bodega%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  select * into v_b from sgc.bodegas where id = p_bodega;
  if not found then raise exception 'La bodega no existe.' using errcode = '22023'; end if;
  select * into v_c from sgc.odoo_corte_bodega where bodega_id = p_bodega;
  return jsonb_build_object(
    'fase_corte', coalesce((select habilitada from sgc.odoo_fases where clave = 'corte'), false),
    'configurada', v_c.bodega_id is not null, 'fecha_corte', v_c.fecha_corte, 'apertura_hecha', coalesce(v_c.apertura_hecha, false),
    'hoy', (now() at time zone 'America/Santo_Domingo')::date, 'location_id', v_b.odoo_location_id, 'nombre', v_b.nombre,
    'saldos', coalesce((select jsonb_agg(jsonb_build_object('odoo_product_id', a.odoo_product_id, 'cantidad', s.cantidad, 'nombre', a.nombre))
                          from sgc.stock_por_bodega s join sgc.articulos a on a.id = s.articulo_id
                         where s.bodega_id = p_bodega and a.odoo_product_id is not null), '[]'::jsonb));
end $fn$;

create or replace function sgc.odoo_corte_apertura_marcar(p_bodega uuid, p_ok boolean, p_resultado jsonb default null, p_error text default null)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  update sgc.odoo_corte_bodega
     set apertura_hecha = case when p_ok then true else apertura_hecha end, apertura_en = case when p_ok then now() else apertura_en end,
         apertura_resultado = coalesce(p_resultado, apertura_resultado), apertura_error = case when p_ok then null else p_error end, actualizada_en = now()
   where bodega_id = p_bodega;
  if not found then raise exception 'Configura primero el corte de la bodega.' using errcode = '22023'; end if;
end $fn$;

-- Proyeccion: marca la sesion para que el bloqueo de abajo la deje pasar (es la unica escritora legitima de una bodega con fuente Odoo).
create or replace function sgc.odoo_stock_proyectar(p_bodega uuid, p_filas jsonb)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  if not exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega and fuente_odoo) then return 0; end if;
  perform set_config('sgc.odoo_proyectando', 'true', true);
  with f as (select (x ->> 'odoo_product_id')::bigint as pid, (x ->> 'cantidad')::numeric as cant from jsonb_array_elements(p_filas) x),
  m as (select a.id as articulo_id, f.cant from f join sgc.articulos a on a.odoo_product_id = f.pid)
  insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad, updated_at)
  select m.articulo_id, p_bodega, m.cant, now() from m
  on conflict (articulo_id, bodega_id) do update set cantidad = excluded.cantidad, updated_at = now();
  get diagnostics v_n = row_count;
  perform set_config('sgc.odoo_proyectando', 'false', true);
  return v_n;
end $fn$;

-- Bloqueo: en una bodega con fuente Odoo, `stock_por_bodega` solo lo escribe la proyeccion, salvo contingencia vigente aprobada por admin.
-- Los consumidores de la tabla no se reescriben (ADR 6): su RPC falla con este mensaje en lugar de dejar a SGC y Odoo divergir.
create or replace function sgc.tg_stock_por_bodega_fuente_odoo()
returns trigger language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_b uuid;
begin
  v_b := case when tg_op = 'DELETE' then old.bodega_id else new.bodega_id end;
  if coalesce(current_setting('sgc.odoo_proyectando', true), '') <> 'true'
     and exists (select 1 from sgc.odoo_corte_bodega where bodega_id = v_b and fuente_odoo)
     and not sgc.odoo_movimiento_permitido(v_b, false) then
    raise exception 'El stock de este almacén lo gobierna Odoo y no se puede modificar directamente. Si Odoo no responde, un administrador puede aprobar una contingencia.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $fn$;
drop trigger if exists tg_stock_por_bodega_fuente_odoo on sgc.stock_por_bodega;
create trigger tg_stock_por_bodega_fuente_odoo before insert or update or delete on sgc.stock_por_bodega
  for each row execute function sgc.tg_stock_por_bodega_fuente_odoo();

-- Estado del corte por bodega para la pantalla (admin/Tecnologia/inventario).
create or replace function sgc.odoo_corte_listado()
returns table (bodega_id uuid, bodega text, codigo_odoo text, homologada boolean, fecha_corte date, apertura_hecha boolean, apertura_en timestamptz, apertura_error text, fuente_odoo boolean, contingencia_hasta timestamptz)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia() or sgc.tiene_modulo('inventario')) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  return query
    select b.id, b.nombre::text, b.codigo_odoo::text, b.odoo_location_id is not null, c.fecha_corte, coalesce(c.apertura_hecha, false), c.apertura_en, c.apertura_error,
           coalesce(c.fuente_odoo, false), (select max(k.vigente_hasta) from sgc.odoo_contingencias k where k.bodega_id = b.id and k.vigente_hasta > now())
      from sgc.bodegas b left join sgc.odoo_corte_bodega c on c.bodega_id = b.id
     where b.activo and b.odoo_location_id is not null
     order by b.nombre;
end $fn$;

-- ── Grants explicitos (audit-rpc-grants no entiende listas) ─────────────────────────────────────────────────────────────────
revoke all on function sgc.salida_pdf_firmado_registrar(uuid, text) from public, anon;
revoke all on function sgc.odoo_ajuste_solicitar(uuid) from public, anon;
revoke all on function sgc.odoo_ajuste_decidir(uuid, boolean, text) from public, anon;
revoke all on function sgc.odoo_v1_marcar_ajuste_sync(uuid, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function sgc.odoo_ajustes_listado() from public, anon;
revoke all on function sgc.odoo_prueba_real_autorizar(text, uuid, text, integer) from public, anon;
revoke all on function sgc.odoo_vinculo_libre_evaluar(uuid, uuid) from public, anon;
revoke all on function sgc.odoo_corte_apertura_preparar(uuid) from public, anon, authenticated;
revoke all on function sgc.odoo_corte_apertura_marcar(uuid, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function sgc.odoo_stock_proyectar(uuid, jsonb) from public, anon, authenticated;
revoke all on function sgc.odoo_corte_listado() from public, anon;
revoke all on function sgc.tg_odoo_ajuste_faltante() from public, anon, authenticated;
revoke all on function sgc.tg_odoo_prueba_a_real() from public, anon, authenticated;
revoke all on function sgc.tg_stock_por_bodega_fuente_odoo() from public, anon, authenticated;
grant execute on function sgc.salida_pdf_firmado_registrar(uuid, text) to authenticated, service_role;
grant execute on function sgc.odoo_ajuste_solicitar(uuid) to authenticated, service_role;
grant execute on function sgc.odoo_ajuste_decidir(uuid, boolean, text) to authenticated, service_role;
grant execute on function sgc.odoo_v1_marcar_ajuste_sync(uuid, uuid, bigint, text, text) to service_role;
grant execute on function sgc.odoo_ajustes_listado() to authenticated, service_role;
grant execute on function sgc.odoo_prueba_real_autorizar(text, uuid, text, integer) to authenticated, service_role;
grant execute on function sgc.odoo_vinculo_libre_evaluar(uuid, uuid) to authenticated, service_role;
grant execute on function sgc.odoo_corte_apertura_preparar(uuid) to service_role;
grant execute on function sgc.odoo_corte_apertura_marcar(uuid, boolean, jsonb, text) to service_role;
grant execute on function sgc.odoo_stock_proyectar(uuid, jsonb) to service_role;
grant execute on function sgc.odoo_corte_listado() to authenticated, service_role;
