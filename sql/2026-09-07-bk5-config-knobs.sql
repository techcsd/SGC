-- BK5 — Knobs de configuración que hoy viven en código.
-- Aditivo, idempotente, retrocompatible. Los VALORES sembrados = los literales
-- que hoy usa el código, para NO cambiar comportamiento al aplicar.
--
-- Nota BK5(a): las "26 claves huérfanas" del apunte NO estaban huérfanas — ya
-- están sembradas (fuel/flota en sgc.flota_config; gps/despachante en
-- sgc.parametros). El hueco real era que admin/parametros sólo leía UNA tabla.
-- Eso se resolvió en la web (pantalla "Configuración del sistema" unificada), sin
-- migración. Aquí sólo nacen los knobs que SÍ faltaban.

begin;

-- ── 1) Tolerancias de la conciliación de combustible (BK5.d) ─────────────────
-- Hoy en código: conciliacion-combustible.ts:23-25 (DIAS=2, GAL=0.5, MONTO=50).
-- Van a flota_config (lectura pública: policy flota_config_sel = true), para que
-- la pantalla de conciliación (módulo flota) las lea sin ser admin. Se editan por
-- el RPC set_flota_config (gate admin/flota), ya cableado en la Config unificada.
insert into sgc.flota_config (clave, valor) values
  ('conciliacion_dias_tolerancia',  '2'),
  ('conciliacion_gal_tolerancia',   '0.5'),
  ('conciliacion_monto_tolerancia', '50')
on conflict (clave) do nothing;

-- NOTA: kpi_config (BK5.c) y el knob único de mínimo de fotos (BK5.e) quedan como
-- follow-up documentado (HANDOFF): el primero necesita su propio formulario para
-- no nacer como tabla+RPC sin llamador (regla 6.5); el segundo toca dos overloads
-- de crear_bitacora_app + el RPC web + clientes app (paridad PROMPT-37) y es un
-- path caliente de data de obra — no se hace a medias.

commit;
