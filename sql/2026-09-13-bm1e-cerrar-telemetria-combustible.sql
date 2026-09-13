-- BM1e — Cerrar en telemetría (app_error_estados) los rechazos de NEGOCIO de combustible
-- que BG2 clasificó como 'sistema'. Complemento de FASE 1.5 de BM1: la migración
-- bm1 limpió sgc.outbox_atascados, pero los reportes viven en sgc.app_error_reports /
-- app_error_estados (canal BG2). Detectado en la auditoría del 13-sep (PROMPT-46);
-- decisión de Xaviel: cerrarlos (el panel de BI4 los medía como avería).
--
-- Son 11 ocurrencias en 4 firmas: DR481 "solo el usuario asignado" (7 + 1 mojibake),
-- salto de km (2) — ambos rechazos de negocio legítimos — y 1 error de infraestructura
-- YA resuelto (ambigüedad de sobrecarga de registrar_combustible_app en v1.97.0; hoy
-- existe una sola sobrecarga de 20 args).
--
-- Se marcan 'solucionado' con resuelto_en_version='2.21.0' (el fix de cliente que honrará
-- DR481→'dato' llega con la app; PROMPT-41): así las recurrencias de clientes <2.21.0
-- cuentan como ocurrencias_cliente_viejo y NO reabren el grupo.
--
-- NOTA: se escribe directo a la tabla (no vía sgc.marcar_error_estado) porque ese RPC
-- gatea por auth.uid()/es_tecnologia() y esto se aplicó desde la Management API (rol
-- postgres, sin JWT). El efecto es idéntico al del RPC. Ya aplicado a prod el 13-sep.

insert into sgc.app_error_estados (firma, estado, nota, resuelto_por, resuelto_at, resuelto_en_version, updated_at)
values
 ('[combustible] Solo el usuario asignado a este vehículo puede registrar su combustible.',
  'solucionado','BM1 auditoría 13-sep (PROMPT-46): rechazo de negocio legítimo (DR481), no avería. Recurrencias de clientes <2.21.0 = ruido esperado hasta el fix de app (PROMPT-41).',
  null, now(), '2.21.0', now()),
 ('[combustible] El salto de kilometraje (…) supera el máximo permitido (…). Verifica la lectura del odómetro.',
  'solucionado','BM1 auditoría 13-sep: rechazo de negocio (salto de km) que viaja por error_campo. No es avería.',
  null, now(), '2.21.0', now()),
 ('[combustible] Could not choose the best candidate function between: sgc.registrar_combustible_app(…), sgc.registrar_combustible_app(…)',
  'solucionado','Infra ya resuelta: hoy una sola sobrecarga de registrar_combustible_app (20-arg, p_confirmado). Error de v1.97.0.',
  null, now(), '2.21.0', now()),
 ('[combustible] Solo el usuario asignado a este vehÃ­culo puede registrar su combustible.',
  'solucionado','BM1: variante mojibake del DR481 (v1.95.0). Rechazo de negocio.',
  null, now(), '2.21.0', now())
on conflict (firma) do update set
  estado = excluded.estado,
  nota = excluded.nota,
  resuelto_at = now(),
  resuelto_en_version = excluded.resuelto_en_version,
  reabierto_at = null,
  ocurrencias_cliente_viejo = 0,
  updated_at = now();
