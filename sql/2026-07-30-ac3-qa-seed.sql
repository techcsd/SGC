-- ============================================================================
-- AC3 — Seed de casos de smoke test reales por módulo (30/07/2026)
-- ----------------------------------------------------------------------------
-- Idempotente por (modulo, titulo). Casos base para que el módulo QA nazca usable.
-- ============================================================================

set search_path = sgc, public;

create unique index if not exists uq_qa_cases_modulo_titulo on sgc.qa_test_cases(modulo, titulo);

insert into sgc.qa_test_cases (modulo, titulo, pasos, resultado_esperado, prioridad, plataforma, orden) values
 ('bitacora', 'Crear parte diario de obra', E'1. Abrir Bitácora > Parte diario\n2. Seleccionar proyecto y fecha\n3. Llenar actividades, personal y equipos\n4. Guardar', 'El parte queda registrado y aparece en el listado del proyecto', 'alta', 'ambas', 1),
 ('bitacora', 'Registrar incidente/accidente', E'1. Bitácora > Incidente\n2. Completar descripción, fotos y gravedad\n3. Guardar', 'El incidente se guarda y notifica a los responsables', 'alta', 'ambas', 2),
 ('flota', 'Pre-uso de vehículo (con hallazgo)', E'1. App > Pre-uso\n2. Elegir vehículo\n3. Marcar un ítem en NO con comentario y foto\n4. Firmar y enviar', 'El checklist queda con resultado con_hallazgos y la foto del ítem se ve en el detalle web', 'alta', 'ambas', 3),
 ('flota', 'Pre-uso bloqueante (ítem crítico en NO)', E'1. Pre-uso\n2. Marcar un ítem crítico en NO\n3. Enviar', 'El resultado es bloqueado y se genera el aviso correspondiente', 'alta', 'ambas', 4),
 ('flota', 'Registrar echada de combustible (estación)', E'1. Combustible > Nuevo registro\n2. Origen Estación\n3. Galones, monto, lectura, estación y fotos\n4. Guardar', 'Se calcula precio/galón, rendimiento y costo/km; entra a conciliación', 'alta', 'ambas', 5),
 ('flota', 'Echada de depósito en obra (telehandler)', E'1. Combustible > Nuevo registro\n2. Origen Depósito en obra\n3. Galones, horas del equipo, obra y foto (sin estación ni monto)\n4. Guardar', 'La echada se guarda como consumo interno y NO aparece en la conciliación de estación', 'alta', 'ambas', 6),
 ('flota', 'Reporte semanal del telehandler (15 puntos)', E'1. Checklists > Reporte semanal\n2. Elegir el telehandler\n3. Responder los 15 puntos y fotos de gomas\n4. Enviar', 'Se usa la plantilla del telehandler; las fotos de gomas se ven en el detalle', 'media', 'ambas', 7),
 ('flota', 'Mantenimiento: fila abre su detalle', E'1. Flota > Mantenimientos\n2. Click en una fila', 'Se abre el detalle con tipo, vehículo, km/horas, costo, taller, fechas y quién lo registró', 'media', 'web', 8),
 ('flota', 'No reasignar vehículo en custodia', E'1. Entregar un vehículo a un chofer (recepción)\n2. Intentar asignarlo a otro sin devolver', 'El sistema rechaza con "asignado a X"; tras la devolución sí permite asignarlo', 'alta', 'ambas', 9),
 ('flota', 'Ruta con varias paradas', E'1. Rutas > Crear\n2. Agregar 3 paradas ordenadas\n3. Adjuntar fotos al iniciar\n4. Guardar', 'El detalle muestra las 3 paradas en orden y las fotos de la ruta', 'media', 'ambas', 10),
 ('inventario', 'Conduce con dos firmas', E'1. Crear conduce\n2. Firmar como emisor\n3. Firmar como receptor (nombre libre)\n4. Completar', 'El PDF/impresión estampa ambas firmas; el detalle web las muestra', 'alta', 'ambas', 11),
 ('inventario', 'Salida de inventario descuenta stock', E'1. Registrar salida con ítems\n2. Guardar', 'El stock del almacén baja según lo despachado', 'alta', 'web', 12),
 ('compras', 'Crear solicitud de material', E'1. Solicitudes > Nueva requisición\n2. Agregar ítems y cantidades\n3. Enviar', 'La solicitud aparece donde su aprobador/receptor trabaja', 'alta', 'ambas', 13),
 ('proyectos', 'Cronograma: iniciar y completar tarea', E'1. Proyecto > Cronograma\n2. Iniciar una tarea\n3. Completar con foto', 'La tarea avanza y el cronograma se recalcula según dependencias', 'media', 'web', 14),
 ('tecnologia', 'Monitoreo: alerta de dominio caído', E'1. Simular NXDOMAIN en un dominio monitoreado\n2. Correr check-domains', 'Se crea una alerta crítica y se refleja el semáforo', 'media', 'web', 15),
 ('tecnologia', 'Chofer NO ve Tecnología', E'1. Entrar como chofer (cédula + PIN)\n2. Revisar el menú y navegar a /tecnologia', 'El módulo Tecnología no aparece y la ruta redirige a 403', 'alta', 'ambas', 16),
 ('general', 'Nota compartida respeta permisos', E'1. Usuario A comparte una nota con B como "ver"\n2. B abre la nota\n3. A cambia a "editar"', 'B ve la nota pero no edita con "ver"; con "editar" sí; C no la ve', 'alta', 'ambas', 17),
 ('general', 'Versión nueva registrada en historial', E'1. Desplegar una versión\n2. Abrir Historial de versiones', 'La versión aparece con su título, chips de cambios y link', 'baja', 'web', 18)
on conflict (modulo, titulo) do nothing;
