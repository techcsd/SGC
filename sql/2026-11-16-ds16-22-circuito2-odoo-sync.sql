-- DS-16..DS-22 (ronda DS, 16-nov-2026): soporte de BD del circuito 2 SGC -> Odoo (recepciones, devoluciones, externos, libres, retiros, conteos). ADITIVA.
-- Reutiliza el outbox CY6 (odoo_eventos) y el worker odoo-sync. Todo APAGADO: sin fila habilitada en sgc.odoo_publicacion_politica no se publica nada.
--  1) columnas de estado de sincronizacion (instancia, picking, estado, error, fecha) en entradas, retiros, conduces externos y conteos,
--     protegidas por odoo_v1_proteger_campos (solo el integrador/definer las escribe);
--  2) ubicacion de CUARENTENA por almacen (DS-21), protegida;
--  3) tipos de evento nuevos (conduce_externo, conteo_inventario) + captura de esos dos documentos;
--  4) cambio real -> prueba DESPUES de publicar: genera un evento de compensacion (DS-19);
--  5) un unico evento pendiente por documento (DS-17): los eventos nuevos se funden en el pendiente aun no reclamado;
--  6) RPC de apoyo: marcar sync generico, encolar documento, reintentar generico, vista de estado.
begin;

-- ── 1) estado de sincronizacion por documento ───────────────────────────────
do $c$
declare t text;
begin
  foreach t in array array['entradas_inventario','retiros_material','conduces_externos','conteos_inventario'] loop
    execute format('alter table sgc.%I
      add column if not exists odoo_instancia_id uuid references sgc.odoo_instancias(id),
      add column if not exists odoo_picking_id bigint,
      add column if not exists odoo_sync_estado text,
      add column if not exists odoo_sync_error text,
      add column if not exists odoo_sync_en timestamptz', t);
    if not exists (select 1 from pg_constraint where conrelid = format('sgc.%I', t)::regclass and conname = t || '_odoo_sync_estado_ck') then
      execute format('alter table sgc.%I add constraint %I check (odoo_sync_estado is null or odoo_sync_estado in (''pendiente'',''sincronizado'',''incierto'',''error''))', t, t || '_odoo_sync_estado_ck');
      execute format('alter table sgc.%I add constraint %I check (odoo_picking_id is null or (odoo_picking_id > 0 and odoo_instancia_id is not null))', t, t || '_odoo_picking_ck');
    end if;
    execute format('create index if not exists %I on sgc.%I(odoo_sync_estado) where odoo_sync_estado in (''pendiente'',''incierto'',''error'')', t || '_odoo_sync_pend_ix', t);
    execute format('drop trigger if exists odoo_v1_proteger_campos on sgc.%I', t);
    execute format('create trigger odoo_v1_proteger_campos before insert or update on sgc.%I for each row execute function sgc.odoo_v1_proteger_campos(''odoo_instancia_id'',''odoo_picking_id'',''odoo_sync_estado'',''odoo_sync_error'',''odoo_sync_en'')', t);
  end loop;
end $c$;

-- ── 2) cuarentena por almacen (paso fisico: Inventario crea la ubicacion NO despachable en Odoo y la enlaza) ──
alter table sgc.bodegas add column if not exists odoo_cuarentena_location_id bigint;
comment on column sgc.bodegas.odoo_cuarentena_location_id is 'DS-21: ubicacion de Odoo (interna, no despachable) para material danado en cuarentena. Se enlaza por el integrador/admin.';
do $c$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'sgc.bodegas'::regclass and conname = 'bodegas_odoo_cuarentena_ck') then
    alter table sgc.bodegas add constraint bodegas_odoo_cuarentena_ck check (odoo_cuarentena_location_id is null or (odoo_cuarentena_location_id > 0 and odoo_instancia_id is not null));
  end if;
end $c$;
drop trigger if exists odoo_v1_proteger_cuarentena on sgc.bodegas;
create trigger odoo_v1_proteger_cuarentena before insert or update on sgc.bodegas
  for each row execute function sgc.odoo_v1_proteger_campos('odoo_cuarentena_location_id');

-- ── 3) tipos de evento nuevos (se conservan los ya permitidos por otras rondas) ──
do $c$
declare v_def text; v_lista text[]; v_nuevo text[] := array['conduce_externo','conteo_inventario']; v_x text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'sgc.odoo_eventos'::regclass and conname = 'odoo_eventos_agregado_tipo_check';
  select coalesce(array_agg(m[1]), '{}') into v_lista from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as m;
  foreach v_x in array v_nuevo loop
    if not (v_x = any(v_lista)) then v_lista := v_lista || v_x; end if;
  end loop;
  alter table sgc.odoo_eventos drop constraint odoo_eventos_agregado_tipo_check;
  execute format('alter table sgc.odoo_eventos add constraint odoo_eventos_agregado_tipo_check check (agregado_tipo = any (%L::text[]))', v_lista);
end $c$;

-- Captura de los dos documentos nuevos (cabecera + renglones en el COMMIT, igual que CY6).
create or replace function sgc.odoo_v1_capturar_evento_ds() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_tipo text; v_inst uuid; v_n integer; v_rev integer; v_payload jsonb; v_prueba boolean;
begin
  if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then return new; end if;
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return new; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  if tg_table_name = 'conduces_externos' then
    v_tipo := 'conduce_externo';
    select to_jsonb(x) into v_payload from sgc.conduces_externos x where x.id = new.id;
  else
    v_tipo := 'conteo_inventario';
    select to_jsonb(c) || jsonb_build_object('lineas', coalesce((select jsonb_agg(to_jsonb(i)) from sgc.conteo_items i where i.conteo_id = c.id), '[]'::jsonb))
      into v_payload from sgc.conteos_inventario c where c.id = new.id;
  end if;
  if v_payload is null then return new; end if;
  v_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  select coalesce(max(revision), 0) + 1 into v_rev from sgc.odoo_eventos where agregado_tipo = v_tipo and agregado_id = new.id::text;
  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_inst, v_tipo, new.id::text, case tg_op when 'INSERT' then 'crear' else 'actualizar' end, v_rev, v_payload, v_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing;
  return new;
end $fn$;
revoke all on function sgc.odoo_v1_capturar_evento_ds() from public, anon, authenticated;

drop trigger if exists odoo_v1_capturar_evento_ds on sgc.conduces_externos;
create constraint trigger odoo_v1_capturar_evento_ds after insert or update on sgc.conduces_externos
  deferrable initially deferred for each row execute function sgc.odoo_v1_capturar_evento_ds();
drop trigger if exists odoo_v1_capturar_evento_ds on sgc.conteos_inventario;
create constraint trigger odoo_v1_capturar_evento_ds after insert or update on sgc.conteos_inventario
  deferrable initially deferred for each row execute function sgc.odoo_v1_capturar_evento_ds();

-- ── 4) real -> prueba despues de publicar (DS-19): el efecto en Odoo se compensa, no queda activo ──
-- El worker ignora los eventos es_prueba=true; este evento va con es_prueba=false y el publicador decide (compensar / omitir / bloquear con motivo).
create or replace function sgc.odoo_v1_flip_prueba() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_tipo text; v_inst uuid; v_n integer; v_rev integer;
begin
  if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then return new; end if;
  if not (coalesce(old.es_prueba, false) = false and coalesce(new.es_prueba, false) = true) then return new; end if;
  v_tipo := case tg_table_name when 'entradas_inventario' then 'entrada_inventario' when 'salidas_inventario' then 'salida_inventario'
                               when 'retiros_material' then 'retiro_material' when 'conteos_inventario' then 'conteo_inventario'
                               when 'conduces_externos' then 'conduce_externo' end;
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return new; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  select coalesce(max(revision), 0) + 1 into v_rev from sgc.odoo_eventos where agregado_tipo = v_tipo and agregado_id = new.id::text;
  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_inst, v_tipo, new.id::text, 'actualizar', v_rev, to_jsonb(new) || jsonb_build_object('motivo_evento', 'cambio_a_prueba'), false)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing;
  return new;
end $fn$;
revoke all on function sgc.odoo_v1_flip_prueba() from public, anon, authenticated;
do $c$
declare t text;
begin
  foreach t in array array['entradas_inventario','salidas_inventario','retiros_material','conteos_inventario','conduces_externos'] loop
    execute format('drop trigger if exists odoo_v1_flip_prueba on sgc.%I', t);
    execute format('create trigger odoo_v1_flip_prueba after update of es_prueba on sgc.%I for each row execute function sgc.odoo_v1_flip_prueba()', t);
  end loop;
end $c$;

-- ── 5) un unico evento pendiente por documento (DS-17) ──
-- Aprobar una requisicion con auto-conduce, crear una salida directa y la escritura posterior de destino producen varias filas para el mismo
-- documento. El publicador lee el estado VIVO de SGC, asi que basta UN evento pendiente: los nuevos se funden en el pendiente aun no reclamado.
-- (es_prueba = AND: un evento de compensacion por cambio a prueba no se vuelve a «prueba» por un evento normal posterior.)
create or replace function sgc.odoo_v1_coalescer_evento() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare v_id uuid;
begin
  if new.agregado_tipo not in ('entrada_inventario','salida_inventario','retiro_material','conteo_inventario','conduce_externo') then return new; end if;
  select id into v_id from sgc.odoo_eventos
   where odoo_instancia_id = new.odoo_instancia_id and agregado_tipo = new.agregado_tipo and agregado_id = new.agregado_id
     and estado = 'pendiente' and lease_token is null
   order by revision desc limit 1 for update skip locked;
  if v_id is null then return new; end if;
  update sgc.odoo_eventos set payload = new.payload, es_prueba = (es_prueba and new.es_prueba), actualizado_en = now() where id = v_id;
  return null; -- no se inserta una revision nueva
end $fn$;
revoke all on function sgc.odoo_v1_coalescer_evento() from public, anon, authenticated;
drop trigger if exists odoo_v1_coalescer_evento on sgc.odoo_eventos;
create trigger odoo_v1_coalescer_evento before insert on sgc.odoo_eventos for each row execute function sgc.odoo_v1_coalescer_evento();

-- ── 6) RPC de apoyo ──
create or replace function sgc.odoo_v1_marcar_documento_sync(
  p_tabla text, p_id uuid, p_instancia uuid, p_picking bigint, p_estado text, p_error text default null
) returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (auth.role() = 'service_role' or sgc.is_admin()) then
    raise exception 'Solo service_role o admin puede marcar la sincronizacion' using errcode = '42501';
  end if;
  if p_tabla not in ('entradas_inventario','retiros_material','conduces_externos','conteos_inventario') then raise exception 'tabla no permitida: %', p_tabla; end if;
  if p_estado not in ('pendiente','sincronizado','incierto','error') then raise exception 'estado invalido: %', p_estado; end if;
  perform set_config('sgc.odoo_importando', 'true', true); -- este UPDATE no debe generar otro evento
  execute format('update sgc.%I set odoo_instancia_id = coalesce($1, odoo_instancia_id), odoo_picking_id = coalesce($2, odoo_picking_id),
                  odoo_sync_estado = $3, odoo_sync_error = case when $3 = ''sincronizado'' and $4 is null then null else $4 end, odoo_sync_en = now() where id = $5', p_tabla)
    using p_instancia, p_picking, p_estado, p_error, p_id;
end $fn$;
revoke all on function sgc.odoo_v1_marcar_documento_sync(text, uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function sgc.odoo_v1_marcar_documento_sync(text, uuid, uuid, bigint, text, text) to service_role;

-- Re-encola un documento (el worker lo reevalua con el estado vivo). Solo service_role (lo llaman los publicadores).
create or replace function sgc.odoo_v1_encolar_documento(p_tipo text, p_id uuid, p_motivo text default null) returns uuid
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_inst uuid; v_n integer; v_rev integer; v_payload jsonb; v_prueba boolean; v_id uuid;
begin
  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then return null; end if;
  select id into v_inst from sgc.odoo_instancias where habilitada;
  if p_tipo = 'entrada_inventario' then
    select to_jsonb(e) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb), 'motivo_evento', p_motivo)
      into v_payload from sgc.entradas_inventario e left join sgc.detalle_entradas d on d.entrada_id = e.id where e.id = p_id group by e.id;
  elsif p_tipo = 'conduce_externo' then
    select to_jsonb(x) || jsonb_build_object('motivo_evento', p_motivo) into v_payload from sgc.conduces_externos x where x.id = p_id;
  elsif p_tipo = 'retiro_material' then
    select to_jsonb(r) || jsonb_build_object('motivo_evento', p_motivo) into v_payload from sgc.retiros_material r where r.id = p_id;
  elsif p_tipo = 'conteo_inventario' then
    select to_jsonb(c) || jsonb_build_object('motivo_evento', p_motivo) into v_payload from sgc.conteos_inventario c where c.id = p_id;
  else
    raise exception 'tipo no soportado: %', p_tipo;
  end if;
  if v_payload is null then return null; end if;
  v_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  select coalesce(max(revision), 0) + 1 into v_rev from sgc.odoo_eventos where agregado_tipo = p_tipo and agregado_id = p_id::text;
  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_inst, p_tipo, p_id::text, 'actualizar', v_rev, v_payload, v_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing returning id into v_id;
  return v_id;
end $fn$;
revoke all on function sgc.odoo_v1_encolar_documento(text, uuid, text) from public, anon, authenticated;
grant execute on function sgc.odoo_v1_encolar_documento(text, uuid, text) to service_role;

-- «Reintentar» generico (Tecnologia/admin): eventos en error o incierto del documento vuelven a pendiente.
create or replace function sgc.odoo_reintentar_documento(p_tipo text, p_id uuid) returns integer
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer; v_tabla text;
begin
  if not (sgc.is_admin() or sgc.es_tecnologia() or auth.role() = 'service_role') then
    raise exception 'Solo Tecnologia o un administrador puede reintentar la sincronizacion' using errcode = '42501';
  end if;
  v_tabla := case p_tipo when 'entrada_inventario' then 'entradas_inventario' when 'retiro_material' then 'retiros_material'
                         when 'conduce_externo' then 'conduces_externos' when 'conteo_inventario' then 'conteos_inventario'
                         when 'salida_inventario' then 'salidas_inventario' end;
  if v_tabla is null then raise exception 'tipo no soportado: %', p_tipo; end if;
  update sgc.odoo_eventos set estado = 'pendiente', lease_token = null, lease_hasta = null, error = null, actualizado_en = now()
   where agregado_tipo = p_tipo and agregado_id = p_id::text and estado in ('error','incierto');
  get diagnostics v_n = row_count;
  perform set_config('sgc.odoo_importando', 'true', true);
  execute format('update sgc.%I set odoo_sync_estado = ''pendiente'', odoo_sync_error = null where id = $1 and odoo_sync_estado in (''error'',''incierto'')', v_tabla) using p_id;
  return v_n;
end $fn$;
revoke all on function sgc.odoo_reintentar_documento(text, uuid) from public, anon;
grant execute on function sgc.odoo_reintentar_documento(text, uuid) to authenticated, service_role;

-- Estado de sincronizacion de todos los documentos del circuito 2 (AT11: lo que se envia se puede ver). Solo Tecnologia/admin.
create or replace function sgc.odoo_documentos_sync_listado(p_solo_problemas boolean default true, p_limite integer default 200)
returns table (tipo text, documento_id uuid, estado text, error text, picking_id bigint, actualizado_en timestamptz)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select u.tipo, u.id, u.odoo_sync_estado, u.odoo_sync_error, u.odoo_picking_id, u.odoo_sync_en
  from (
    select 'entrada_inventario'::text tipo, id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.entradas_inventario where odoo_sync_estado is not null
    union all select 'retiro_material', id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.retiros_material where odoo_sync_estado is not null
    union all select 'conduce_externo', id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.conduces_externos where odoo_sync_estado is not null
    union all select 'conteo_inventario', id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.conteos_inventario where odoo_sync_estado is not null
  ) u
  where (not p_solo_problemas) or u.odoo_sync_estado <> 'sincronizado' or u.odoo_sync_error is not null
  order by u.odoo_sync_en desc nulls last limit greatest(1, least(coalesce(p_limite, 200), 1000));
end $fn$;
revoke all on function sgc.odoo_documentos_sync_listado(boolean, integer) from public, anon;
grant execute on function sgc.odoo_documentos_sync_listado(boolean, integer) to authenticated, service_role;

commit;
