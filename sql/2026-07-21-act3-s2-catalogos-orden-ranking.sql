-- ============================================================================
-- Actualización 3 · S2 — Orden de ejecución + ranking de uso por obra en los
-- catálogos de bitácora (estructuras / actividades / restricciones).
-- ----------------------------------------------------------------------------
-- Antes: sgc.bitacora_catalogos se ordenaba alfabético por `valor`.
-- Ahora:
--   1) columna aditiva `orden int` + seeds con el orden pedido (estructuras en
--      orden de ejecución; actividades en orden de proceso — doc §Z encofrado).
--   2) tabla ligera `bitacora_catalogo_usos` (contador por obra) alimentada por
--      los RPC de creación de bitácora (ver migración -rpc-bitacora).
--   3) RPC `catalogo_ordenado(p_proyecto_id)` que devuelve el catálogo activo
--      con las ~3 más usadas de esa obra primero y el resto en orden de proceso.
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/dbq.mjs --file sql/2026-07-21-act3-s2-catalogos-orden-ranking.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) Columna orden + seeds ────────────────────────────────────────────────
alter table sgc.bitacora_catalogos add column if not exists orden int not null default 0;
comment on column sgc.bitacora_catalogos.orden is
  'Orden de presentación (menor primero). Estructuras: orden de ejecución; actividades: orden de proceso.';

-- Estructuras — orden de ejecución (S2).
update sgc.bitacora_catalogos set orden = v.orden
from (values
  ('COLUMNAS',1), ('MUROS',2), ('VIGAS',3), ('LOSAS',4),
  ('VIGAS RIOSTRAS',5), ('ZAPATAS/PLATEA',6)
) as v(valor, orden)
where sgc.bitacora_catalogos.tipo='estructura' and sgc.bitacora_catalogos.valor = v.valor;

-- Actividades — orden de proceso (doc §Z: topografía → … → desencofrado).
update sgc.bitacora_catalogos set orden = v.orden
from (values
  ('TOPOGRAFIA',1), ('CEPOS',2), ('ENCOFRADO',3), ('ARMADO',4),
  ('LIBERACION MIVED',5), ('TERMINACIONES DE ENCOFRADO/ARMADO',6),
  ('VACIADO',7), ('DESENCOFRADO',8)
) as v(valor, orden)
where sgc.bitacora_catalogos.tipo='actividad' and sgc.bitacora_catalogos.valor = v.valor;

-- Restricciones — NINGUNA primero, OTRO al final.
update sgc.bitacora_catalogos set orden = v.orden
from (values
  ('NINGUNA',1), ('FALTA DE MATERIALES',2), ('FALTA DE EQUIPOS/HERRAMIENTAS',3),
  ('INTERFERENCIA DE OTRAS BRIGADAS',4), ('FALTA DE LIBERACION PARA INICIO DE TRABAJOS',5),
  ('FALTA DEL CLIENTE',6), ('CLIMA',7), ('OTRO',99)
) as v(valor, orden)
where sgc.bitacora_catalogos.tipo='restriccion' and sgc.bitacora_catalogos.valor = v.valor;

-- ── 2) Ranking de uso por obra ──────────────────────────────────────────────
create table if not exists sgc.bitacora_catalogo_usos (
  proyecto_id uuid  not null references sgc.proyectos(id) on delete cascade,
  tipo        text  not null check (tipo in ('estructura','actividad')),
  valor       text  not null,
  usos        int   not null default 0,
  ultimo_uso  timestamptz,
  primary key (proyecto_id, tipo, valor)
);
comment on table sgc.bitacora_catalogo_usos is
  'Contador de uso de estructura/actividad por obra; alimenta el ranking "más usadas" de S2. Se actualiza en los RPC de bitácora.';

alter table sgc.bitacora_catalogo_usos enable row level security;
drop policy if exists bcu_select on sgc.bitacora_catalogo_usos;
create policy bcu_select on sgc.bitacora_catalogo_usos for select to authenticated using (true);
-- Escritura solo vía RPC SECURITY DEFINER (sin policy de escritura directa).

grant usage on schema sgc to authenticated;
grant select on sgc.bitacora_catalogo_usos to authenticated;
grant all on sgc.bitacora_catalogo_usos to service_role;

-- ── 3) RPC catalogo_ordenado(p_proyecto_id) ────────────────────────────────
-- Devuelve el catálogo activo: por tipo, primero las ~3 más usadas de la obra
-- (usos > 0), luego el resto en orden de proceso. `destacado` marca las top-3
-- para que la UI pueda pintar una sección "Más usadas". Si p_proyecto_id es
-- null, no hay ranking (todo por orden de proceso).
create or replace function sgc.catalogo_ordenado(p_proyecto_id uuid default null)
returns table (
  tipo text, valor text, activo boolean, orden int,
  usos int, ultimo_uso timestamptz, destacado boolean
)
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $$
  with c as (
    select bc.tipo, bc.valor, bc.activo, bc.orden,
           coalesce(u.usos, 0) as usos, u.ultimo_uso
    from sgc.bitacora_catalogos bc
    left join sgc.bitacora_catalogo_usos u
      on u.tipo = bc.tipo and u.valor = bc.valor and u.proyecto_id = p_proyecto_id
    where bc.activo
  ),
  ranked as (
    select c.*,
           row_number() over (
             partition by c.tipo
             order by c.usos desc, c.ultimo_uso desc nulls last, c.orden, c.valor
           ) as rn
    from c
  )
  select tipo, valor, activo, orden, usos, ultimo_uso,
         (usos > 0 and rn <= 3) as destacado
  from ranked
  order by tipo,
           (case when usos > 0 and rn <= 3 then 0 else 1 end),
           (case when usos > 0 and rn <= 3 then rn else null end) nulls last,
           orden, valor;
$$;

grant execute on function sgc.catalogo_ordenado(uuid) to authenticated, service_role;
