-- sql/2026-10-29-db15-pagos-obra.sql — Ronda DB (PROMPT-124 F5, DB4)
-- Pagos semanales al personal de obra con DESCARGO (finiquito) firmado — pedido
-- de Sócrates vía Xaviel: el ingeniero arma la semana, cada persona firma el
-- descargo en el teléfono, y al enviar se genera un PDF (hoja por persona con
-- identificación + monto + texto del descargo + firma) que llega por correo a
-- Legal (Sonia), Eduardo y las personas extra (Yonairis cuando Xaviel ponga su
-- correo en `pagos_descargo_correos_extra`).
--
-- Seguridad (DB-15/DB-16 + lección DA F4): los MONTOS son dato sensible.
--   · Pantalla: submódulo `ingenieria.pagos` (catálogo SUBMODULOS + permisos
--     granulares sembrados aquí).
--   · Datos: gates PROPIOS `puede_ver_pagos`/`puede_operar_pagos` (NO el helper
--     AG12 `nivel_submodulo`, cuyo atajo regala 'operar' a todo el que tenga el
--     módulo `ingenieria` completo). Operar = ingeniero_campo / gerente_proyectos
--     / jefe_ingenieros EN SUS obras; ver = abogado / gerencia / direccion; admin
--     todo. Fuera de Compa/conector (guard verify-boveda-fuera-de-ia).
--   · Escrituras SOLO por RPCs SECURITY DEFINER.
--
--   node scripts/apply-migration.mjs sql/2026-10-29-db15-pagos-obra.sql --env dev

-- ── 0) Gates propios ──────────────────────────────────────────────────────────
create or replace function sgc.puede_operar_pagos(p_proyecto_id uuid)
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select sgc.is_admin() or (
    exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = auth.uid()
        and r.codigo in ('ingeniero_campo','gerente_proyectos','jefe_ingenieros'))
    and sgc.puede_ver_proyecto(p_proyecto_id)
  );
$function$;
grant execute on function sgc.puede_operar_pagos(uuid) to authenticated, service_role;

create or replace function sgc.puede_ver_pagos(p_proyecto_id uuid)
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select sgc.puede_operar_pagos(p_proyecto_id) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('abogado','gerencia','direccion')
  );
$function$;
grant execute on function sgc.puede_ver_pagos(uuid) to authenticated, service_role;

-- ── 1) Tablas ─────────────────────────────────────────────────────────────────
create table if not exists sgc.pagos_obra (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id),
  semana_desde date not null,
  semana_hasta date not null,
  estado text not null default 'borrador' check (estado in ('borrador','enviado')),
  complemento_de uuid references sgc.pagos_obra(id),
  creado_por uuid references sgc.usuarios(id),
  enviado_at timestamptz,
  enviado_por uuid references sgc.usuarios(id),
  pdf_path text,
  correos_enviados text[],
  reabierto_por uuid references sgc.usuarios(id),
  reabierto_at timestamptz,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Una semana = un pago por obra (los complementos no chocan con el principal).
create unique index if not exists uq_pagos_obra_semana
  on sgc.pagos_obra (proyecto_id, semana_desde) where complemento_de is null;

create table if not exists sgc.pagos_obra_lineas (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null references sgc.pagos_obra(id) on delete cascade,
  personal_id uuid not null references sgc.personal_obra(id),
  nombre_snapshot text not null,
  documento_tipo_snapshot text,
  documento_numero_snapshot text,
  cargo_snapshot text,
  monto numeric check (monto is null or monto >= 0),
  concepto text,
  firma_path text,
  firmado_at timestamptz,
  firmado_en text check (firmado_en in ('app','web')),
  estado text not null default 'pendiente' check (estado in ('pendiente','firmado','ausente')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pago_id, personal_id)
);
create index if not exists idx_pagos_lineas_pago on sgc.pagos_obra_lineas (pago_id);

alter table sgc.pagos_obra enable row level security;
alter table sgc.pagos_obra_lineas enable row level security;
drop policy if exists "pagos_obra: ver" on sgc.pagos_obra;
create policy "pagos_obra: ver" on sgc.pagos_obra
  for select to authenticated using (sgc.puede_ver_pagos(proyecto_id));
drop policy if exists "pagos_lineas: ver" on sgc.pagos_obra_lineas;
create policy "pagos_lineas: ver" on sgc.pagos_obra_lineas
  for select to authenticated
  using (exists (select 1 from sgc.pagos_obra p where p.id = pago_id and sgc.puede_ver_pagos(p.proyecto_id)));
grant select on sgc.pagos_obra, sgc.pagos_obra_lineas to authenticated;
grant select, insert, update, delete on sgc.pagos_obra, sgc.pagos_obra_lineas to service_role;

-- ── 2) Submódulo (pantalla) + permisos sembrados ──────────────────────────────
update sgc.roles set permisos = permisos || '{"ingenieria.pagos":"operar"}'::jsonb
 where codigo in ('ingeniero_campo','gerente_proyectos','jefe_ingenieros')
   and coalesce(permisos->>'ingenieria.pagos','') <> 'operar';
update sgc.roles set permisos = permisos || '{"ingenieria.pagos":"ver"}'::jsonb
 where codigo in ('abogado','gerencia','direccion')
   and coalesce(permisos->>'ingenieria.pagos','') = '';

-- ── 3) Parámetros + plantilla del descargo ────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('pagos_descargo_correos', 'depto.legal@constructorasd.com,eduardong@constructorasd.com',
   'Correos que reciben el reporte de pagos con descargo al enviarlo (CSV).'),
  ('pagos_descargo_correos_extra', '',
   'Personas extra que reciben el reporte de pagos (CSV de correos). Aquí va Yonairis cuando Xaviel tenga su correo.')
on conflict (clave) do nothing;

-- BG5 — categoría nueva ⇒ el CHECK se amplía en la MISMA migración (aditivo).
alter table sgc.plantillas_documento drop constraint if exists plantillas_documento_categoria_check;
alter table sgc.plantillas_documento add constraint plantillas_documento_categoria_check
  check (categoria = any (array['contrato','recibo_pago','orden_pago','carta_entrega','acta_incidencia','descargo','otro']));

insert into sgc.plantillas_documento (nombre, categoria, contenido_html, campos, origen, activo, es_default)
select 'descargo_pago_semanal', 'descargo',
  '<p>Yo, <strong>{{nombre}}</strong>, portador del documento de identidad <strong>{{documento}}</strong>, '
  || 'declaro que recibí de {{empresa}} el pago correspondiente a la semana del {{desde}} al {{hasta}} '
  || 'por un monto de <strong>RD$ {{monto}}</strong> por concepto de {{concepto}}, en la obra {{obra}}. '
  || 'Con este pago quedo saldado(a) por los trabajos realizados en ese período y no queda pendiente '
  || 'ninguna suma a mi favor por ese concepto. Firmo libre y voluntariamente.</p>',
  '[]'::jsonb, 'sistema', true, false
where not exists (select 1 from sgc.plantillas_documento where nombre = 'descargo_pago_semanal');

-- ── 4) RPC: crear la semana (precarga el personal del último levantamiento) ──
create or replace function sgc.pagos_obra_crear(p_proyecto_id uuid, p_desde date, p_hasta date)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_lev uuid;
begin
  if not sgc.puede_operar_pagos(p_proyecto_id) then
    raise exception 'Solo los ingenieros de la obra pueden crear la semana de pagos.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Elige una semana válida (desde ≤ hasta).' using errcode = '22023';
  end if;
  select id into v_id from sgc.pagos_obra
   where proyecto_id = p_proyecto_id and semana_desde = p_desde and complemento_de is null;
  if found then return v_id; end if;

  insert into sgc.pagos_obra (proyecto_id, semana_desde, semana_hasta, creado_por)
  values (p_proyecto_id, p_desde, p_hasta, auth.uid())
  returning id into v_id;

  -- Precarga: presentes del último levantamiento cerrado; si no hay, toda la obra.
  select id into v_lev from sgc.personal_obra_levantamientos
   where proyecto_id = p_proyecto_id and cerrado_at is not null
   order by fecha desc limit 1;

  insert into sgc.pagos_obra_lineas
    (pago_id, personal_id, nombre_snapshot, documento_tipo_snapshot, documento_numero_snapshot, cargo_snapshot)
  select v_id, p.id,
         trim(concat_ws(' ', p.nombre, p.apellido)),
         p.tipo_documento, p.documento_numero, c.nombre
  from sgc.personal_obra p
  left join sgc.cargos c on c.id = p.cargo_id
  where p.proyecto_id = p_proyecto_id
    and p.eliminado_at is null
    and coalesce(p.activo_en_obra, true)
    and (v_lev is null or exists (
      select 1 from sgc.personal_obra_levantamiento_lineas li
      where li.levantamiento_id = v_lev and li.personal_id = p.id and li.presente));
  return v_id;
end $function$;
grant execute on function sgc.pagos_obra_crear(uuid, date, date) to authenticated;

-- ── 5) RPC: guardar una línea (monto/concepto/firma/ausente) ──────────────────
create or replace function sgc.pagos_obra_linea_guardar(
  p_linea_id uuid,
  p_monto numeric default null,
  p_concepto text default null,
  p_firma_path text default null,
  p_firmado_en text default 'web',
  p_ausente boolean default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_pago sgc.pagos_obra%rowtype;
begin
  select pg.* into v_pago
  from sgc.pagos_obra pg join sgc.pagos_obra_lineas l on l.pago_id = pg.id
  where l.id = p_linea_id;
  if not found then raise exception 'Línea no encontrada.' using errcode = 'P0002'; end if;
  if not sgc.puede_operar_pagos(v_pago.proyecto_id) then
    raise exception 'Solo los ingenieros de la obra pueden editar los pagos.' using errcode = '42501';
  end if;
  if v_pago.estado <> 'borrador' then
    raise exception 'Esta semana ya fue enviada; usa «complemento» para lo que faltó.' using errcode = '22023';
  end if;
  if p_firmado_en not in ('app','web') then p_firmado_en := 'web'; end if;

  update sgc.pagos_obra_lineas set
    monto = coalesce(p_monto, monto),
    concepto = coalesce(nullif(trim(p_concepto), ''), concepto),
    firma_path = coalesce(p_firma_path, firma_path),
    firmado_at = case when p_firma_path is not null then now() else firmado_at end,
    firmado_en = case when p_firma_path is not null then p_firmado_en else firmado_en end,
    estado = case
      when p_firma_path is not null then 'firmado'
      when p_ausente is true then 'ausente'
      when p_ausente is false and estado = 'ausente' then 'pendiente'
      else estado end,
    updated_at = now()
  where id = p_linea_id;
end $function$;
grant execute on function sgc.pagos_obra_linea_guardar(uuid, numeric, text, text, text, boolean) to authenticated;

-- ── 6) RPC: enviar (exige ≥1 firmada; pg_net a la edge; cierra) ───────────────
create or replace function sgc.pagos_obra_enviar(p_pago_id uuid)
returns text
language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_pago sgc.pagos_obra%rowtype;
  v_firmadas int;
  v_secret text;
begin
  select * into v_pago from sgc.pagos_obra where id = p_pago_id for update;
  if not found then raise exception 'Pago no encontrado.' using errcode = 'P0002'; end if;
  if not sgc.puede_operar_pagos(v_pago.proyecto_id) then
    raise exception 'Solo los ingenieros de la obra pueden enviar el reporte.' using errcode = '42501';
  end if;
  if v_pago.estado <> 'borrador' then
    raise exception 'Esta semana ya fue enviada.' using errcode = '22023';
  end if;
  select count(*) into v_firmadas from sgc.pagos_obra_lineas
   where pago_id = p_pago_id and estado = 'firmado' and firma_path is not null;
  if v_firmadas = 0 then
    raise exception 'No hay ningún descargo firmado: el reporte se envía con al menos una firma.' using errcode = '22023';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    raise exception 'Falta el secreto infra_sync_secret en este entorno.' using errcode = '22023';
  end if;

  update sgc.pagos_obra
     set estado = 'enviado', enviado_at = now(), enviado_por = auth.uid(), updated_at = now()
   where id = p_pago_id;

  perform net.http_post(
    url := sgc.edge_url('pagos-descargo-enviar'),
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
    body := jsonb_build_object('pago_id', p_pago_id));
  return 'enviando';
end $function$;
grant execute on function sgc.pagos_obra_enviar(uuid) to authenticated;

-- ── 7) RPC: complemento (las líneas que quedaron sin firmar) ──────────────────
create or replace function sgc.pagos_obra_complemento(p_pago_id uuid)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_pago sgc.pagos_obra%rowtype;
  v_id uuid;
begin
  select * into v_pago from sgc.pagos_obra where id = p_pago_id;
  if not found then raise exception 'Pago no encontrado.' using errcode = 'P0002'; end if;
  if not sgc.puede_operar_pagos(v_pago.proyecto_id) then
    raise exception 'Solo los ingenieros de la obra pueden crear el complemento.' using errcode = '42501';
  end if;
  if v_pago.estado <> 'enviado' then
    raise exception 'El complemento se crea después de enviar la semana.' using errcode = '22023';
  end if;
  insert into sgc.pagos_obra (proyecto_id, semana_desde, semana_hasta, complemento_de, creado_por, es_prueba)
  values (v_pago.proyecto_id, v_pago.semana_desde, v_pago.semana_hasta, v_pago.id, auth.uid(), v_pago.es_prueba)
  returning id into v_id;

  insert into sgc.pagos_obra_lineas
    (pago_id, personal_id, nombre_snapshot, documento_tipo_snapshot, documento_numero_snapshot, cargo_snapshot, monto, concepto)
  select v_id, l.personal_id, l.nombre_snapshot, l.documento_tipo_snapshot, l.documento_numero_snapshot,
         l.cargo_snapshot, l.monto, l.concepto
  from sgc.pagos_obra_lineas l
  where l.pago_id = p_pago_id and l.estado <> 'firmado';
  return v_id;
end $function$;
grant execute on function sgc.pagos_obra_complemento(uuid) to authenticated;

-- ── 8) RPC: reabrir (solo admin, con rastro) ──────────────────────────────────
create or replace function sgc.pagos_obra_reabrir(p_pago_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede reabrir una semana enviada.' using errcode = '42501';
  end if;
  update sgc.pagos_obra
     set estado = 'borrador', reabierto_por = auth.uid(), reabierto_at = now(), updated_at = now()
   where id = p_pago_id and estado = 'enviado';
  if not found then raise exception 'Pago no encontrado o no está enviado.' using errcode = 'P0002'; end if;
end $function$;
grant execute on function sgc.pagos_obra_reabrir(uuid) to authenticated;
