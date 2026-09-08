-- ============================================================================
-- PROMPT-40 (BM) FASE 4 — BM5: factor de empaque MÁQUINA-LEGIBLE (esquema).
-- Ronda 09/09/2026.  Aditivo, idempotente, retrocompatible.  §D aprobado por Xaviel:
-- factor + cantidad SIEMPRE en unidad base.
--
-- PROBLEMA (verificado): el "💡 ATADO 120 PZA" es `articulos.nota` (texto libre); el
-- `120` no lo lee nadie.  `sgc.unidades` es una lista plana sin factor.  El stock se
-- mueve por delta sin unidad (`adjust_stock`); `detalle_salidas` no tiene unidad.  En
-- el momento en que el atado sea seleccionable, `cantidad` se vuelve ambiguo (un `2`
-- ¿son 2 piezas o 240?) y no hay columna que lo desambigüe.  Hoy el workaround es
-- crear OTRO artículo ('… (PAQUETE DE 30 UDS)'), justo lo que BJ6 dijo que no.
--
-- MODELO (copia la fontanería de `talla`, 2026-07-15, NO su semántica: talla es
-- inerte, el factor es aritmética que llega al stock):
--   · `articulos.unidad_paquete` + `articulos.factor_paquete` → el empaque es dato,
--     no una cadena de texto.  Bandera implícita: factor_paquete not null ⇒ la UI
--     ofrece "por unidad" o "por <empaque>".
--   · en el RENGLÓN: `unidad_capturada` + `factor_aplicado` (default 1), y `cantidad`
--     SIEMPRE en unidad base.  Así NINGÚN trigger de stock, el kardex, el costeo
--     (costo_unit/costo_promedio) ni los reportes se tocan — sólo se ENRIQUECE el
--     renglón para poder mostrar "2 atados (240 PZA)".
--
-- Sólo ESQUEMA aquí (aditivo): las columnas del renglón nacen con default sano, así
-- el stock sigue exacto sin tocar RPCs.  El plumbing de los RPCs (leer
-- unidad_capturada/factor_aplicado del jsonb) y la UI van con la pasada de UI, que es
-- donde se EMPIEZA a enviar el atado — sin UI que lo mande, no hay ambigüedad que
-- desambiguar.  El backfill de los ~17 artículos va en el archivo bm5b (a revisión).
--
-- Reglas 1 y 2 del checklist: las columnas van sobre tablas existentes (heredan su
-- RLS) y la NOT NULL nueva (factor_aplicado) nace con DEFAULT.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm5-factor-empaque-schema.sql
-- ============================================================================

begin;

-- ── Artículo: empaque máquina-legible ────────────────────────────────────────
alter table sgc.articulos add column if not exists unidad_paquete text;   -- vs sgc.unidades.codigo (soft ref, como `unidad`)
alter table sgc.articulos add column if not exists factor_paquete numeric; -- piezas base por empaque; null = sin empaque

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'articulos_factor_paquete_pos') then
    alter table sgc.articulos
      add constraint articulos_factor_paquete_pos check (factor_paquete is null or factor_paquete > 0);
  end if;
end $$;

comment on column sgc.articulos.unidad_paquete is 'BM5 — código de empaque (vs sgc.unidades.codigo); null = sólo se vende por unidad base.';
comment on column sgc.articulos.factor_paquete is 'BM5 — cuántas unidades base trae un empaque (ATADO 120 → 120). null = sin empaque.';

-- ── Renglón: qué unidad capturó el usuario y su factor (cantidad SIEMPRE en base) ─
alter table sgc.solicitud_material_items add column if not exists unidad_capturada text;
alter table sgc.solicitud_material_items add column if not exists factor_aplicado numeric not null default 1;

alter table sgc.detalle_salidas add column if not exists unidad_capturada text;
alter table sgc.detalle_salidas add column if not exists factor_aplicado numeric not null default 1;

comment on column sgc.detalle_salidas.factor_aplicado is 'BM5 — factor con que se capturó (1 = unidad base). cantidad SIEMPRE en base; el renglón muestra cantidad/factor + unidad_capturada.';
comment on column sgc.solicitud_material_items.factor_aplicado is 'BM5 — ver detalle_salidas.factor_aplicado.';

commit;
