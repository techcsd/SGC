-- ============================================================================
-- DA4/DA6 (PROMPT-122, ronda DA, 27-oct-2026) — Inventario tecnológico,
-- FASE 4: clave del equipo (CONTEXTO-ACTUALIZACION-60.md §1 nota 1F, 5.1, DA-06).
--
-- Caso real: Dell Inspiron 5502 en stock, clave compartida en una nota adhesiva
-- (1289 — NUNCA se escribe en este repo/test/commit). Riesgo (Xaviel): guardar
-- claves en texto plano es inseguro.
--
-- Diseño (DA-06, default aplicado — contradicción §3.1 del contexto resuelta):
--   - Cifrada con la MISMA criptografía del Vault (AES-256-GCM, BOVEDA_MASTER_KEY
--     — una sola llave maestra por entorno), pero tabla y gate PROPIOS, FUERA del
--     Vault (DZ-08: el Vault es is_admin() estricto; una clave de equipo
--     compartida es mucho menos sensible y necesita su propio alcance).
--   - Gate: sgc.puede_ver_claves_equipos() = is_admin() O permiso granular
--     'tecnologia.claves_equipos'. OJO (a propósito): NO se usa
--     puede_ver_submodulo()/puede_operar_submodulo() de AG12 para este gate —
--     esos helpers tienen un fallback de COMPATIBILIDAD que da 'operar' a
--     cualquiera con el módulo PADRE completo (sgc.tiene_modulo('tecnologia'));
--     si se usara aquí, CUALQUIER rol con el módulo tecnologia vería las claves
--     sin que nadie se lo haya dado a propósito — exactamente lo que Xaviel
--     pidió evitar ("que nadie lo reciba por defecto, tampoco el
--     Subadministrador"). Por eso el predicado de abajo mira el permiso
--     granular DIRECTO, sin el atajo de módulo.
--   - Sin SELECT para `authenticated` (como boveda_entradas, CZ3/CZ9): todo
--     ver/guardar/quitar pasa por la edge `equipos-clave` (service role).
--   - Toda vista/cambio queda en tec_equipo_historial (tipo_cambio='clave'),
--     SIN el valor.
--
-- Aditivo, idempotente. Regla 18: dev primero.
-- Apply: node scripts/apply-migration.mjs sql/2026-10-27-da4-claves-equipos.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Predicado propio (NO AG12 — ver nota arriba) ────────────────────────
create or replace function sgc.puede_ver_claves_equipos()
returns boolean
language sql stable security definer set search_path = sgc, public
as $$
  select sgc.is_admin() or exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and coalesce(r.permisos ->> 'tecnologia.claves_equipos', '') in ('ver', 'operar')
  );
$$;
grant execute on function sgc.puede_ver_claves_equipos() to authenticated, service_role;

-- ── (2) tec_equipo_claves — SIN select para authenticated ───────────────────
create table if not exists sgc.tec_equipo_claves (
  equipo_id        uuid primary key references sgc.tec_equipos(id) on delete cascade,
  tipo_clave       text not null check (tipo_clave in ('personal', 'compartida')),
  valor_cifrado    bytea,
  valor_iv         bytea,
  clave_version    int not null default 1,
  actualizada_por  uuid references sgc.usuarios(id),
  actualizada_en   timestamptz not null default now()
);
comment on table sgc.tec_equipo_claves is
  'DA-06 — clave de acceso del equipo (PIN/contraseña compartida o personal), cifrada AES-256-GCM (misma llave maestra del Vault, BOVEDA_MASTER_KEY). Fuera del Vault (CZ3/CZ9): gate propio (sgc.puede_ver_claves_equipos), no is_admin() estricto. Solo la edge equipos-clave (service role) la toca.';

alter table sgc.tec_equipo_claves enable row level security;
-- Sin políticas para `authenticated`: ni siquiera metadata (a diferencia de
-- boveda_entradas, aquí NO hace falta listar "hay o no hay clave" desde el
-- cliente — la ficha del equipo ya lo sabe por tec_equipos, ver DA-19/F4 web).
revoke all on sgc.tec_equipo_claves from authenticated;
grant select, insert, update, delete on sgc.tec_equipo_claves to service_role;

-- ── (3) Permiso granular (AG12 — solo la ENTRADA en el catálogo de roles.ts;
--     el gate de este archivo NO usa el helper AG12, ver nota del encabezado) ─
-- Nadie lo recibe por defecto (ni el Subadministrador) — Xaviel decide a mano
-- desde Administración › Roles quién lo recibe (paso físico, §6 del prompt).

-- ── (4) Bandera NO SECRETA "tiene clave guardada" ────────────────────────────
-- Expone solo EXISTENCIA (no el valor) en `tec_equipos`, que SÍ es legible por
-- quien ve el inventario — así la ficha puede mostrar "Clave guardada" / "Sin
-- clave" sin una llamada a la edge. Mantenida por trigger desde
-- tec_equipo_claves (único escritor real: la edge equipos-clave).
alter table sgc.tec_equipos add column if not exists tiene_clave boolean not null default false;
comment on column sgc.tec_equipos.tiene_clave is
  'DA-06 — solo indica si hay una clave guardada (no el valor); la mantiene un trigger desde tec_equipo_claves. Safe de leer con el resto del equipo.';

create or replace function sgc.tg_tec_equipo_claves_sync_flag()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    update sgc.tec_equipos set tiene_clave = false where id = old.equipo_id;
    return old;
  else
    update sgc.tec_equipos set tiene_clave = (new.valor_cifrado is not null) where id = new.equipo_id;
    return new;
  end if;
end;
$$;
drop trigger if exists trg_tec_equipo_claves_sync_flag on sgc.tec_equipo_claves;
create trigger trg_tec_equipo_claves_sync_flag
  after insert or update or delete on sgc.tec_equipo_claves
  for each row execute function sgc.tg_tec_equipo_claves_sync_flag();

commit;
