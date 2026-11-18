-- DS-27/DS-28/DS-29 (ronda DS, 16-nov-2026; issues #114-#116): fases 3-6 de Miranda construidas COMPLETAS pero APAGADAS. ADITIVA.
--  DS-27 Canary: flag por fase + configuracion del par/piloto + ratificacion firmada de ADR + criterios de salida medibles.
--  DS-28 Expansion: solicitud de ajuste por faltante con aprobacion (ADR 5) + SLO de publicacion (99 % < 2 min) como alerta.
--  DS-29 Corte: apertura/fecha de corte por bodega, `stock_por_bodega` como PROYECCION desde Odoo bajo el flag por bodega
--         (`odoo_corte_bodega.fuente_odoo`), contingencia aprobada por admin si Odoo no responde (ADR 3, 6).
-- Nada se enciende aqui: todas las filas nacen con habilitada=false / fuente_odoo=false. Sin hosts/usuarios/ids de Odoo.

-- ── Flags por fase ───────────────────────────────────────────────────────────
create table if not exists sgc.odoo_fases (
  clave text primary key check (clave in ('canary', 'expansion', 'corte', 'contraccion')),
  habilitada boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  actualizada_por uuid,
  actualizada_en timestamptz not null default now()
);
insert into sgc.odoo_fases (clave) values ('canary'), ('expansion'), ('corte'), ('contraccion') on conflict do nothing;
alter table sgc.odoo_fases enable row level security;
drop policy if exists odoo_fases_sel on sgc.odoo_fases;
create policy odoo_fases_sel on sgc.odoo_fases for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_fases to authenticated;
grant all on sgc.odoo_fases to service_role;

-- ── Ratificacion firmada de decisiones (ADR 4, 5, 10, 11, 15) ──────────────────
create table if not exists sgc.odoo_ratificaciones (
  adr integer primary key,
  ratificada_por uuid not null,
  ratificada_en timestamptz not null default now(),
  nota text
);
alter table sgc.odoo_ratificaciones enable row level security;
drop policy if exists odoo_ratificaciones_sel on sgc.odoo_ratificaciones;
create policy odoo_ratificaciones_sel on sgc.odoo_ratificaciones for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_ratificaciones to authenticated;
grant all on sgc.odoo_ratificaciones to service_role;

create or replace function sgc.odoo_ratificar_adr(p_adr integer, p_nota text default null)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede ratificar una decisión.' using errcode = '42501'; end if;
  if p_adr not in (4, 5, 10, 11, 15) then raise exception 'La decisión % no requiere ratificación.', p_adr using errcode = '22023'; end if;
  insert into sgc.odoo_ratificaciones (adr, ratificada_por, nota) values (p_adr, auth.uid(), nullif(btrim(coalesce(p_nota, '')), ''))
  on conflict (adr) do update set ratificada_por = auth.uid(), ratificada_en = now(), nota = excluded.nota;
end $fn$;

-- Enciende/apaga una fase (solo admin). Encender exige los requisitos de esa fase; apagar siempre se puede.
create or replace function sgc.odoo_fase_set(p_clave text, p_habilitada boolean, p_config jsonb default null)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_cfg jsonb; v_faltan integer;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede cambiar una fase.' using errcode = '42501'; end if;
  select coalesce(p_config, config) into v_cfg from sgc.odoo_fases where clave = p_clave;
  if not found then raise exception 'Fase desconocida: %', p_clave using errcode = '22023'; end if;
  if p_habilitada then
    if p_clave = 'canary' then
      select 5 - count(*) into v_faltan from sgc.odoo_ratificaciones where adr in (4, 5, 10, 11, 15);
      if v_faltan > 0 then raise exception 'Faltan % ratificación(es) firmada(s) de decisiones antes del canary.', v_faltan using errcode = '22023'; end if;
      if coalesce(v_cfg #>> '{par,origen}', '') = '' or coalesce(v_cfg #>> '{par,destino}', '') = ''
         or jsonb_array_length(coalesce(v_cfg -> 'articulos_piloto', '[]'::jsonb)) = 0
         or jsonb_array_length(coalesce(v_cfg -> 'usuarios_piloto', '[]'::jsonb)) = 0 then
        raise exception 'El canary necesita el par de almacenes, los artículos piloto y los usuarios piloto.' using errcode = '22023';
      end if;
    elsif p_clave = 'expansion' then
      if not (select habilitada from sgc.odoo_fases where clave = 'canary') then raise exception 'La expansión exige el canary encendido y con criterios cumplidos.' using errcode = '22023'; end if;
    elsif p_clave = 'corte' then
      if not (select habilitada from sgc.odoo_fases where clave = 'expansion') then raise exception 'El corte exige la expansión encendida.' using errcode = '22023'; end if;
    elsif p_clave = 'contraccion' then
      raise exception 'La contracción no se enciende desde aquí: es una migración condicional (ver docs/ODOO-ISSUES-ESTADO.md).' using errcode = '22023';
    end if;
  end if;
  update sgc.odoo_fases set habilitada = p_habilitada, config = v_cfg, actualizada_por = auth.uid(), actualizada_en = now() where clave = p_clave;
end $fn$;

-- ── DS-27 Canary: ¿esta salida entra al piloto? ──────────────────────────────
-- Con el canary APAGADO devuelve true (no restringe: la publicacion la gobierna la politica del outbox).
-- Encendido: solo el par origen->destino configurado, con TODOS los renglones en articulos piloto y creada por un usuario piloto.
create or replace function sgc.odoo_canary_permite(p_salida uuid)
returns boolean language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_f sgc.odoo_fases%rowtype; v_s sgc.salidas_inventario%rowtype; v_org text; v_dst text;
begin
  if not (auth.role() = 'service_role' or sgc.es_tecnologia()) then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;
  select * into v_f from sgc.odoo_fases where clave = 'canary';
  if not coalesce(v_f.habilitada, false) then return true; end if;
  select * into v_s from sgc.salidas_inventario where id = p_salida;
  if not found then return false; end if;
  select codigo_odoo into v_org from sgc.bodegas where id = v_s.bodega_id;
  select codigo_odoo into v_dst from sgc.bodegas where id = v_s.destino_almacen_id;
  if v_org is distinct from (v_f.config #>> '{par,origen}') or v_dst is distinct from (v_f.config #>> '{par,destino}') then return false; end if;
  if not (coalesce(v_s.creado_por::text, '') in (select jsonb_array_elements_text(coalesce(v_f.config -> 'usuarios_piloto', '[]'::jsonb)))) then return false; end if;
  return not exists (
    select 1 from sgc.detalle_salidas d
     where d.salida_id = p_salida
       and not (d.articulo_id::text in (select jsonb_array_elements_text(coalesce(v_f.config -> 'articulos_piloto', '[]'::jsonb)))));
end $fn$;

-- Criterios de salida medibles del canary: p99 de publicacion < 5 s y 0 movimientos fuera de canal abiertos.
create or replace function sgc.odoo_canary_criterios()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_p99 numeric; v_n integer; v_fuera integer;
begin
  if not sgc.es_tecnologia() then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;
  select percentile_disc(0.99) within group (order by extract(epoch from (actualizado_en - creado_en))), count(*)
    into v_p99, v_n from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and estado = 'completado' and creado_en > now() - interval '30 days';
  select count(*) into v_fuera from sgc.odoo_discrepancias where tipo = 'fuera_de_canal' and resuelta_en is null;
  return jsonb_build_object('muestras', coalesce(v_n, 0), 'p99_publicacion_s', round(coalesce(v_p99, 0)::numeric, 1), 'fuera_de_canal_abiertas', v_fuera,
    'cumple_p99', coalesce(v_n, 0) > 0 and coalesce(v_p99, 0) < 5, 'cumple_fuera_de_canal', v_fuera = 0,
    'ratificaciones', (select coalesce(jsonb_agg(adr order by adr), '[]'::jsonb) from sgc.odoo_ratificaciones));
end $fn$;

-- ── DS-28 Expansion: solicitud de ajuste por faltante (ADR 5) ────────────────
-- Faltante = recibido < enviado en un conduce entregado incompleto. El material faltante queda EN TRANSITO hasta que
-- el jefe de inventario/admin decida: aprobar (se ajusta) o rechazar (se devuelve transito -> origen).
create table if not exists sgc.odoo_solicitudes_ajuste (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references sgc.salidas_inventario(id) on delete cascade,
  articulo_id uuid not null references sgc.articulos(id),
  faltante numeric not null check (faltante > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  accion text check (accion in ('ajuste', 'devolver_transito')),
  decidida_por uuid,
  decidida_en timestamptz,
  nota text,
  creada_en timestamptz not null default now(),
  unique (salida_id, articulo_id)
);
alter table sgc.odoo_solicitudes_ajuste enable row level security;
drop policy if exists odoo_ajuste_sel on sgc.odoo_solicitudes_ajuste;
create policy odoo_ajuste_sel on sgc.odoo_solicitudes_ajuste for select to authenticated using (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_tecnologia());
grant select on sgc.odoo_solicitudes_ajuste to authenticated;
grant all on sgc.odoo_solicitudes_ajuste to service_role;
create index if not exists odoo_ajuste_pend_ix on sgc.odoo_solicitudes_ajuste(estado) where estado = 'pendiente';

create or replace function sgc.odoo_ajuste_solicitar(p_salida uuid)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  if not (auth.role() = 'service_role' or sgc.is_admin() or sgc.tiene_modulo('inventario')) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  insert into sgc.odoo_solicitudes_ajuste (salida_id, articulo_id, faltante)
  select d.salida_id, d.articulo_id, d.cantidad - d.cantidad_recibida
    from sgc.detalle_salidas d join sgc.salidas_inventario s on s.id = d.salida_id
   where d.salida_id = p_salida and s.estado = 'entregado_incompleto' and coalesce(s.es_prueba, false) = false
     and d.cantidad_recibida is not null and d.cantidad_recibida < d.cantidad
  on conflict (salida_id, articulo_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform sgc.notificar_modulo('inventario', 'alerta', 'Faltante por resolver', 'Un conduce llegó incompleto: aprueba el ajuste o devuelve el material desde tránsito.', '/tecnologia/odoo-conciliacion');
  end if;
  return v_n;
end $fn$;

create or replace function sgc.odoo_ajuste_decidir(p_id uuid, p_aprobar boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
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
         decidida_por = auth.uid(), decidida_en = now(), nota = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id and estado = 'pendiente';
  if not found then raise exception 'La solicitud no existe o ya fue resuelta.' using errcode = '22023'; end if;
end $fn$;

-- SLO de publicacion: 99 % de los eventos de salida completados en < 2 min (ultimos 7 dias).
create or replace function sgc.odoo_slo_publicacion()
returns jsonb language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer; v_ok integer;
begin
  if not (auth.role() = 'service_role' or sgc.es_tecnologia()) then raise exception 'Solo Tecnologia' using errcode = '42501'; end if;
  select count(*), count(*) filter (where actualizado_en - creado_en < interval '2 minutes') into v_n, v_ok
    from sgc.odoo_eventos where agregado_tipo = 'salida_inventario' and estado = 'completado' and creado_en > now() - interval '7 days';
  return jsonb_build_object('muestras', v_n, 'pct_en_2min', case when v_n = 0 then null else round(100.0 * v_ok / v_n, 1) end, 'cumple', v_n = 0 or (100.0 * v_ok / v_n) >= 99);
end $fn$;

-- Alerta (1 por dia) si la expansion esta encendida y el SLO no se cumple con muestra suficiente.
create or replace function sgc.odoo_slo_evaluar()
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  if not coalesce((select habilitada from sgc.odoo_fases where clave = 'expansion'), false) then return; end if;
  v := sgc.odoo_slo_publicacion();
  if (v ->> 'muestras')::integer >= 10 and not (v ->> 'cumple')::boolean
     and not exists (select 1 from sgc.notificaciones where titulo = 'SLO de publicación a Odoo incumplido' and created_at > now() - interval '1 day') then
    perform sgc.odoo_notificar_tecnologia('SLO de publicación a Odoo incumplido', 'Solo el ' || (v ->> 'pct_en_2min') || ' % de los conduces se publicó en menos de 2 minutos (meta 99 %).', '/tecnologia/odoo-conciliacion');
  end if;
end $fn$;

-- ── DS-29 Corte: apertura por bodega y stock como proyeccion de Odoo ─────────
create table if not exists sgc.odoo_corte_bodega (
  bodega_id uuid primary key references sgc.bodegas(id),
  fecha_corte date,
  apertura_hecha boolean not null default false,
  fuente_odoo boolean not null default false, -- flag `odoo_fuente_stock` POR BODEGA
  actualizada_por uuid,
  actualizada_en timestamptz not null default now()
);
alter table sgc.odoo_corte_bodega enable row level security;
drop policy if exists odoo_corte_sel on sgc.odoo_corte_bodega;
create policy odoo_corte_sel on sgc.odoo_corte_bodega for select to authenticated using (sgc.es_tecnologia() or sgc.tiene_modulo('inventario'));
grant select on sgc.odoo_corte_bodega to authenticated;
grant all on sgc.odoo_corte_bodega to service_role;

create or replace function sgc.odoo_corte_configurar(p_bodega uuid, p_fecha date, p_apertura_hecha boolean default false)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede configurar el corte.' using errcode = '42501'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de corte.' using errcode = '22023'; end if;
  insert into sgc.odoo_corte_bodega (bodega_id, fecha_corte, apertura_hecha, actualizada_por) values (p_bodega, p_fecha, p_apertura_hecha, auth.uid())
  on conflict (bodega_id) do update set fecha_corte = excluded.fecha_corte, apertura_hecha = excluded.apertura_hecha, actualizada_por = auth.uid(), actualizada_en = now();
end $fn$;

-- Enciende Odoo como fuente del stock de UNA bodega: exige fase `corte` encendida, apertura hecha y bodega homologada.
create or replace function sgc.odoo_corte_fuente_set(p_bodega uuid, p_activa boolean)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede cambiar la fuente del stock.' using errcode = '42501'; end if;
  if p_activa then
    if not coalesce((select habilitada from sgc.odoo_fases where clave = 'corte'), false) then raise exception 'La fase de corte está apagada.' using errcode = '22023'; end if;
    if not exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega and apertura_hecha and fecha_corte is not null) then
      raise exception 'La bodega no tiene apertura hecha ni fecha de corte.' using errcode = '22023';
    end if;
    if not exists (select 1 from sgc.bodegas where id = p_bodega and odoo_location_id is not null) then raise exception 'La bodega no está homologada con Odoo.' using errcode = '22023'; end if;
  end if;
  update sgc.odoo_corte_bodega set fuente_odoo = p_activa, actualizada_por = auth.uid(), actualizada_en = now() where bodega_id = p_bodega;
  if not found then raise exception 'Configura primero el corte de la bodega.' using errcode = '22023'; end if;
end $fn$;

-- Proyeccion: la edge escribe en `stock_por_bodega` lo que dice Odoo (quant) SOLO para bodegas con fuente_odoo.
-- Los 55 consumidores de stock_por_bodega no se reescriben (ADR 6): siguen leyendo la misma tabla.
create or replace function sgc.odoo_stock_proyectar(p_bodega uuid, p_filas jsonb)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Solo service_role' using errcode = '42501'; end if;
  if not exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega and fuente_odoo) then return 0; end if;
  with f as (select (x ->> 'odoo_product_id')::bigint as pid, (x ->> 'cantidad')::numeric as cant from jsonb_array_elements(p_filas) x),
  m as (select a.id as articulo_id, f.cant from f join sgc.articulos a on a.odoo_product_id = f.pid)
  insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad, updated_at)
  select m.articulo_id, p_bodega, m.cant, now() from m
  on conflict (articulo_id, bodega_id) do update set cantidad = excluded.cantidad, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- Contingencia aprobada por admin cuando Odoo no responde (ADR 3): sin ella, una bodega con fuente Odoo no mueve stock.
create table if not exists sgc.odoo_contingencias (
  id uuid primary key default gen_random_uuid(),
  bodega_id uuid not null references sgc.bodegas(id),
  motivo text not null check (length(btrim(motivo)) >= 10),
  aprobada_por uuid not null,
  aprobada_en timestamptz not null default now(),
  vigente_hasta timestamptz not null
);
alter table sgc.odoo_contingencias enable row level security;
drop policy if exists odoo_contingencias_sel on sgc.odoo_contingencias;
create policy odoo_contingencias_sel on sgc.odoo_contingencias for select to authenticated using (sgc.es_tecnologia() or sgc.tiene_modulo('inventario'));
grant select on sgc.odoo_contingencias to authenticated;
grant all on sgc.odoo_contingencias to service_role;

create or replace function sgc.odoo_contingencia_aprobar(p_bodega uuid, p_motivo text, p_horas integer default 4)
returns uuid language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_id uuid;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede aprobar una contingencia.' using errcode = '42501'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 24 then raise exception 'La contingencia dura entre 1 y 24 horas.' using errcode = '22023'; end if;
  insert into sgc.odoo_contingencias (bodega_id, motivo, aprobada_por, vigente_hasta) values (p_bodega, p_motivo, auth.uid(), now() + make_interval(hours => p_horas)) returning id into v_id;
  return v_id;
end $fn$;

-- ¿Puede la bodega mover stock ahora? true si no usa Odoo como fuente, si Odoo responde, o si hay contingencia vigente.
create or replace function sgc.odoo_movimiento_permitido(p_bodega uuid, p_odoo_responde boolean)
returns boolean language sql stable security definer set search_path = sgc, pg_temp as $fn$
  select not coalesce((select fuente_odoo from sgc.odoo_corte_bodega where bodega_id = p_bodega), false)
      or coalesce(p_odoo_responde, false)
      or exists (select 1 from sgc.odoo_contingencias where bodega_id = p_bodega and vigente_hasta > now());
$fn$;

revoke all on function sgc.odoo_ratificar_adr(integer, text), sgc.odoo_fase_set(text, boolean, jsonb), sgc.odoo_canary_permite(uuid), sgc.odoo_canary_criterios(),
  sgc.odoo_ajuste_solicitar(uuid), sgc.odoo_ajuste_decidir(uuid, boolean, text), sgc.odoo_slo_publicacion(), sgc.odoo_slo_evaluar(),
  sgc.odoo_corte_configurar(uuid, date, boolean), sgc.odoo_corte_fuente_set(uuid, boolean), sgc.odoo_stock_proyectar(uuid, jsonb),
  sgc.odoo_contingencia_aprobar(uuid, text, integer), sgc.odoo_movimiento_permitido(uuid, boolean) from public, anon;
grant execute on function sgc.odoo_ratificar_adr(integer, text), sgc.odoo_fase_set(text, boolean, jsonb), sgc.odoo_canary_permite(uuid), sgc.odoo_canary_criterios(),
  sgc.odoo_ajuste_solicitar(uuid), sgc.odoo_ajuste_decidir(uuid, boolean, text), sgc.odoo_slo_publicacion(),
  sgc.odoo_corte_configurar(uuid, date, boolean), sgc.odoo_corte_fuente_set(uuid, boolean), sgc.odoo_contingencia_aprobar(uuid, text, integer),
  sgc.odoo_movimiento_permitido(uuid, boolean) to authenticated, service_role; -- todas gatean adentro
grant execute on function sgc.odoo_slo_evaluar(), sgc.odoo_stock_proyectar(uuid, jsonb) to service_role;
