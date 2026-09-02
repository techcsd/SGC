-- =============================================================================
-- PROMPT-28 (BG) FASE 4 — BG4: Retiro de material DAÑADO — esquema.
-- Ronda 19/08-03/09/2026. Aditivo, idempotente, retrocompatible.
-- Aprobado por Xaviel (01/09/2026): aprueba Raykler/almacén; descarte lo autoriza
-- almacén/dirección/gerencia + roles elevados; 3 disposiciones; conduce reusa el
-- wizard con tipo «retiro».
--
-- El espejo de la requisición, en reversa: la obra pide RETIRAR material dañado →
-- aprobación → conduce de retiro (obra → almacén, u obra → suplidor si es devolución)
-- → el material entra a CUARENTENA (visible, NO despachable) → disposición final
-- (descarte / reparación / devolución a proveedor), toda auditada.
--
-- Modelo de inventario (decisión de diseño): el stock es `stock_por_bodega.cantidad`
-- (escalar, sin columna de estado, invariante `cantidad = apertura + Σmovimientos`).
-- La cuarentena NO puede ser una columna nueva en esa tabla sin romper el invariante,
-- así que va en una tabla HERMANA `stock_cuarentena(articulo, bodega, cantidad)`:
--   · es la "columna propia en Inventario" que pide el ticket,
--   · los selectores de despacho (que leen `stock_por_bodega`) la IGNORAN por
--     construcción → material dañado NUNCA es despachable, sin tocar esos selectores,
--   · cada cambio queda auditado en `stock_cuarentena_mov` (ledger con motivo + retiro).
-- Regla un-solo-camino (AU1): el material dañado entra/sale de cuarentena SOLO por
-- el flujo de retiro; "Ajuste real" (AT12) NO es la vía (rebase silencioso sin traza).
--
-- Reglas de nacimiento (CHECKLIST-MIGRACIONES): RLS por rol (escritura solo vía RPC
-- DEFINER), estado con constraint COMPLETO desde el día uno, NOT NULL con default.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-01-bg4-retiro-material-schema.sql
-- =============================================================================
begin;

-- ── Cabecera del retiro ──────────────────────────────────────────────────────
create table if not exists sgc.retiros_material (
  id                     uuid primary key default gen_random_uuid(),
  folio                  bigint,
  proyecto_id            uuid not null references sgc.proyectos(id),
  solicitante_id         uuid not null references sgc.usuarios(id),
  almacen_destino_id     uuid references sgc.bodegas(id),   -- dónde entra a cuarentena al recibirse
  motivo_dano            text not null
                           check (motivo_dano in ('danado_obra','defecto_fabrica','vencido','otro')),
  motivo_dano_detalle    text,
  -- Estado con constraint COMPLETO desde el día uno (regla 3 del checklist):
  estado                 text not null default 'pendiente'
                           check (estado in ('pendiente','aprobada','en_retiro',
                                             'en_cuarentena','dispuesta','rechazada','cancelada')),
  notas                  text,
  aprobada_por           uuid references sgc.usuarios(id),
  aprobada_en            timestamptz,
  rechazada_motivo       text,
  -- Conduce de retiro (transporte obra→almacén / obra→suplidor) — evidencia
  -- capturada en el propio retiro (AT11: la data se visualiza aquí) + link opcional
  -- al conduce_externo para trazabilidad cruzada en el módulo de conduces.
  conduce_externo_id     uuid references sgc.conduces_externos(id),
  salida_id              uuid references sgc.salidas_inventario(id),
  transporta_proveedor_id uuid references sgc.proveedores_transporte(id),
  transporta_texto       text,
  placa_foto_path        text,
  carga_foto_path        text,
  emisor_firma_path      text,
  recepcion_foto_path    text,
  recepcion_firma_path   text,
  recepcion_notas        text,
  recibido_por           uuid references sgc.usuarios(id),
  recibido_en            timestamptz,
  -- Disposición final (auditada):
  disposicion            text check (disposicion in ('descarte','reparacion','devolucion')),
  disposicion_nota       text,
  proveedor_devolucion_id uuid references sgc.proveedores(id),
  dispuesta_por          uuid references sgc.usuarios(id),
  dispuesta_en           timestamptz,
  cancelada_motivo       text,
  es_prueba              boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists sgc.retiro_material_items (
  id            uuid primary key default gen_random_uuid(),
  retiro_id     uuid not null references sgc.retiros_material(id) on delete cascade,
  articulo_id   uuid references sgc.articulos(id),     -- null = no catalogado
  descripcion   text not null,                          -- nombre del artículo o descripción libre
  cantidad      numeric not null check (cantidad > 0),
  unidad        text
);

-- Fotos OBLIGATORIAS del material dañado (evidencia — corazón del flujo, AS15).
create table if not exists sgc.retiro_material_fotos (
  id         uuid primary key default gen_random_uuid(),
  retiro_id  uuid not null references sgc.retiros_material(id) on delete cascade,
  path       text not null,
  nombre     text,
  created_at timestamptz not null default now()
);

-- ── Cuarentena: stock dañado por almacén (hermana de stock_por_bodega) ───────
create table if not exists sgc.stock_cuarentena (
  articulo_id uuid not null references sgc.articulos(id),
  bodega_id   uuid not null references sgc.bodegas(id),
  cantidad    numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (articulo_id, bodega_id)
);

-- Ledger auditable de cada cambio de cuarentena (entra al recibir, sale al disponer).
create table if not exists sgc.stock_cuarentena_mov (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references sgc.articulos(id),
  bodega_id   uuid not null references sgc.bodegas(id),
  delta       numeric not null,               -- + entra a cuarentena, − sale (dispuesto)
  motivo      text not null,                  -- 'retiro_recibido' | 'descarte' | 'reparacion' | 'devolucion'
  retiro_id   uuid references sgc.retiros_material(id),
  creado_por  uuid references sgc.usuarios(id),
  es_prueba   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cuarentena_mov_bodega on sgc.stock_cuarentena_mov (bodega_id, created_at desc);
create index if not exists idx_retiros_estado on sgc.retiros_material (estado, created_at desc);
create index if not exists idx_retiros_proyecto on sgc.retiros_material (proyecto_id, created_at desc);

-- ── Folio + código RET-###### (patrón BC4: trigger DEFINER, no default nextval) ─
create sequence if not exists sgc.retiros_material_folio_seq;
create or replace function sgc.trg_retiro_material_folio()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if new.folio is null then new.folio := nextval('sgc.retiros_material_folio_seq'); end if;
  return new;
end; $function$;
drop trigger if exists trg_retiro_material_folio on sgc.retiros_material;
create trigger trg_retiro_material_folio
  before insert on sgc.retiros_material
  for each row execute function sgc.trg_retiro_material_folio();
create unique index if not exists uq_retiros_material_folio on sgc.retiros_material (folio);

-- ── Helper: mover cantidad a/desde cuarentena (respeta es_prueba) ────────────
create or replace function sgc.adjust_cuarentena(
  p_articulo_id uuid, p_bodega_id uuid, p_delta numeric,
  p_motivo text, p_retiro_id uuid, p_es_prueba boolean default false
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
begin
  if p_articulo_id is null or p_bodega_id is null or coalesce(p_delta,0) = 0 then return; end if;
  -- Balance real solo para datos reales; los de prueba solo dejan traza en el ledger.
  if not coalesce(p_es_prueba,false) then
    insert into sgc.stock_cuarentena (articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, p_delta, now())
    on conflict (articulo_id, bodega_id)
    do update set cantidad = sgc.stock_cuarentena.cantidad + p_delta, updated_at = now();
  end if;
  insert into sgc.stock_cuarentena_mov (articulo_id, bodega_id, delta, motivo, retiro_id, creado_por, es_prueba)
  values (p_articulo_id, p_bodega_id, p_delta, p_motivo, p_retiro_id, auth.uid(), coalesce(p_es_prueba,false));
end;
$$;
grant execute on function sgc.adjust_cuarentena(uuid, uuid, numeric, text, uuid, boolean) to service_role;

-- ── RLS: escritura SOLO vía RPC DEFINER; lectura por rol + es_prueba oculto ───
alter table sgc.retiros_material       enable row level security;
alter table sgc.retiro_material_items  enable row level security;
alter table sgc.retiro_material_fotos  enable row level security;
alter table sgc.stock_cuarentena       enable row level security;
alter table sgc.stock_cuarentena_mov   enable row level security;

-- Lectura de retiros: el solicitante, inventario/compras, dirección, responsable de
-- la obra, o admin. (Espeja puede_ver de requisiciones.)
drop policy if exists retiros_select on sgc.retiros_material;
create policy retiros_select on sgc.retiros_material
  for select to authenticated using (
    solicitante_id = auth.uid()
    or sgc.is_admin()
    or sgc.tiene_modulo('inventario')
    or sgc.tiene_modulo('compras')
    or sgc.tiene_modulo('direccion')
    or sgc.es_responsable_de_proyecto(proyecto_id)
  );
drop policy if exists retiros_prueba_oculta on sgc.retiros_material;
create policy retiros_prueba_oculta on sgc.retiros_material
  for select to authenticated using ((not es_prueba) or sgc.is_admin());

drop policy if exists retiro_items_select on sgc.retiro_material_items;
create policy retiro_items_select on sgc.retiro_material_items
  for select to authenticated using (exists (
    select 1 from sgc.retiros_material r where r.id = retiro_material_items.retiro_id));

drop policy if exists retiro_fotos_select on sgc.retiro_material_fotos;
create policy retiro_fotos_select on sgc.retiro_material_fotos
  for select to authenticated using (exists (
    select 1 from sgc.retiros_material r where r.id = retiro_material_fotos.retiro_id));

-- Cuarentena: la ve quien ve inventario (para la "columna propia" y Compa).
drop policy if exists cuarentena_select on sgc.stock_cuarentena;
create policy cuarentena_select on sgc.stock_cuarentena
  for select to authenticated using (sgc.puede_ver_inventario_bodega(bodega_id));
drop policy if exists cuarentena_mov_select on sgc.stock_cuarentena_mov;
create policy cuarentena_mov_select on sgc.stock_cuarentena_mov
  for select to authenticated using (sgc.puede_ver_inventario_bodega(bodega_id));

commit;
