-- ════════════════════════════════════════════════════════════════════════════
-- BF9 (Transporte v3 — FASE 3, transición AT7) — APAGAR el auto-conduce.
--
-- El parámetro `requisicion_auto_conduce` nació en 'true' (BA/FASE 1) SOLO para
-- preservar el comportamiento legado "aprobar una requisición genera el conduce
-- automático" HASTA que el flujo de despacho de la app (csd-app) estuviera probado.
-- Ese es el momento: la app ya trae el despacho. Se apaga (=> 'false').
--
-- EFECTO (lo valida `aprobar_requisicion`, que lee el flag en vivo):
--   · Antes ('true'):  aprobar → genera la salida/conduce automáticamente.
--   · Ahora ('false'): aprobar → la requisición queda 'por_despachar' (con las
--     líneas despachables) y el conduce se emite como DESPACHO MANUAL — con la
--     confirmación en el dispositivo del receptor (el flujo real de Transporte v3).
--     El faltante sigue generando su solicitud de compra automática igual.
--
-- 100% REVERSIBLE sin deploy: volver a poner 'true' desde Administración › Parámetros
-- (o este mismo update) restaura el comportamiento legado al instante.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

update sgc.parametros
   set valor = 'false', updated_at = now()
 where clave = 'requisicion_auto_conduce';

commit;
