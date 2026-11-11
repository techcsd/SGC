-- DM6 (ronda DM, PROMPT-140 F5/F6) — clasificación de firmas de sgc.app_error_reports
-- tras el triaje F0 (ver docs/CLAUDE-AUDITORIA.md / HANDOFF para la tabla completa de 60
-- firmas). Marca lo que ya es "regla de negocio" (no bug) y lo ya resuelto en código,
-- con `resuelto_en_version='1.213.0'` para lo cerrado en esta ronda. No toca lo que sigue
-- dependiendo de csd-app (PROMPT-141: GPS/tracking/realtime/sw_update) ni lo instrumentado
-- sin reproducir.

begin;

-- Ya resuelto en código (confirmado por F0, solo faltaba el estado):
insert into sgc.app_error_estados (firma, estado, nota, resuelto_en_version, updated_at) values
  ('(…).trim is not a function', 'solucionado',
   'DH ronda (1.209.0, 03-nov) — parametros-catalogo.ts:165 ya hace String(valor ?? '''').trim(). Sin reincidencia desde entonces.',
   '1.209.0', now()),
  ('Could not embed because more than one relationship was found for ''vehiculos'' and ''usuarios''', 'solucionado',
   'BR1 hotfix (1.139.1, 21-sep) — vehiculos.service.ts usa usuarios!responsable_id en los 4 embeds. Sin reincidencia desde entonces.',
   '1.139.1', now()),
  ('[combustible] function sgc.validar_km_vehiculo(…) does not exist', 'solucionado',
   'DM ronda (10-nov) — DH2 (sql/2026-11-03-dh2-combustible-km-mismo-dia.sql) nunca había llegado a prod; aplicada ahora con F0. Confirma el reporte de Soporte 1a91a8cd de Raykler.',
   '1.213.0', now())
on conflict (firma) do update set
  estado = excluded.estado, nota = excluded.nota, resuelto_en_version = excluded.resuelto_en_version,
  resuelto_por = null, resuelto_at = now(), updated_at = now();

-- Regla de negocio (esperado, no bug) — lista cerrada DM-24:
insert into sgc.app_error_estados (firma, estado, nota, updated_at) values
  ('[combustible] No puedes registrar una echada con fecha pasada (…). Pide a Flota un permiso de registro retroactivo.', 'regla_negocio',
   'DM-21 — permiso retroactivo de Flota funcionando correctamente; no es un fallo.', now()),
  ('GeolocationPositionError(…): User denied Geolocation', 'regla_negocio',
   'DM-24 — la persona negó el permiso de ubicación; no es un fallo del sistema.', now()),
  ('Failed to read the ''localStorage'' property from ''Window'': Access is denied for this document.', 'regla_negocio',
   'DM-24 — navegación en modo privado del navegador; no es un fallo del sistema.', now()),
  ('[conduce_entregado] Este conduce no está despachado.', 'regla_negocio', 'DM-24 — regla de flujo de conduce.', now()),
  ('[conduce_estado_op] Este conduce ya fue entregado; no puedes cambiar su estado de tránsito.', 'regla_negocio', 'DM-24 — regla de flujo de conduce.', now()),
  ('[conduce_firmar_receptor] Todavía no ha llegado. Podrás firmar cuando el chofer lo entregue.', 'regla_negocio', 'DM-24 — regla de flujo de conduce.', now()),
  ('[conduce_entregado] Falta la firma del despachante. No puedes marcar la entrega hasta que el despachante firme el conduce desde su sesión.', 'regla_negocio', 'DM-24 — regla de flujo de conduce.', now()),
  ('[tarea_enlazar] Justificación requerida: la tarea se completa tarde', 'regla_negocio', 'DM-24 — validación de negocio de tareas.', now()),
  ('[inv_salida] Tu usuario no tiene el módulo Inventario', 'regla_negocio', 'DM-24 — gate de rol funcionando correctamente.', now())
on conflict (firma) do update set estado = excluded.estado, nota = excluded.nota, updated_at = now();

-- Existencia insuficiente (conduce_simple/conduce_transportista) — mismo patrón, varias firmas
-- con cantidades/artículos distintos en el texto; se marcan por LIKE para no listar cada una.
insert into sgc.app_error_estados (firma, estado, nota, updated_at)
select sgc.error_firma(r.message), 'regla_negocio', 'DM-24 — regla de negocio (existencia insuficiente al despachar); no es un fallo.', now()
  from sgc.app_error_reports r
 where r.message ilike '%No hay existencia%'
 group by 1
on conflict (firma) do update set estado = excluded.estado, nota = excluded.nota, updated_at = now();

-- En revisión — dependen de csd-app (PROMPT-141) o de un deploy pendiente de este round:
insert into sgc.app_error_estados (firma, estado, nota, updated_at) values
  ('timeout', 'en_revision', 'DM-25 — GPS, csd-app. Timeout adaptativo pendiente en PROMPT-141.', now()),
  ('[object GeolocationPositionError]', 'en_revision', 'DM-25 — GPS, csd-app. Pendiente en PROMPT-141.', now()),
  ('Could not obtain location in time. Try with a higher timeout.', 'en_revision', 'DM-25 — GPS, csd-app. Pendiente en PROMPT-141.', now()),
  ('watcher nativo devolvió error', 'en_revision', 'DM-26 — tracking, csd-app. Causa (permiso de ubicación del SO) ya vista en el contexto; ajuste pendiente en PROMPT-141.', now()),
  ('registrar_posiciones rechazó el lote', 'en_revision', 'DM-26 — tracking, csd-app. Clasificación de causa (sesión/RLS/carga inválida) pendiente en PROMPT-141.', now()),
  ('cannot add `postgres_changes` callbacks for realtime:notificaciones-app-<id> after `subscribe(…)`.', 'en_revision', 'DM-28 — realtime, csd-app (notificaciones.service.ts). Fix de removeChannel awaited pendiente en PROMPT-141.', now()),
  ('sw_update: instalación falló (…)', 'en_revision', 'csd-app, service worker. Pendiente en PROMPT-141 (ya anotado en ronda DH15).', now()),
  ('''text/html'' is not a valid JavaScript MIME type.', 'en_revision', 'DM-27 — chunk perdido. Reescritura SPA corregida en vercel.json de esta ronda (feature/dm-modulo-claude); pendiente deploy a prod vía dev→main.', now()),
  ('Importing a module script failed.', 'en_revision', 'DM-27 — mismo chunk perdido; ver vercel.json de esta ronda.', now())
on conflict (firma) do update set estado = excluded.estado, nota = excluded.nota, updated_at = now();

commit;
