# Release 1.209.0 — WhatsApp: memoria de grupos y hallazgos con IA (ronda DB, PROMPT DB-2)

- Equipo/tester: PENDIENTE — este release NO se puede probar humanamente todavía. Depende de
  que el listener externo (`csd-wa-listener`, repo hermano) esté corriendo y pareado con un
  número de WhatsApp real conectado a los grupos de la empresa. Hasta entonces, lo de abajo es
  un checklist preparado, no una prueba realizada.
- Qué verificó Claude Code (sin navegador humano, sin listener real conectado):
  - `npm run build` — todos los guards del prebuild (incluido `verify-version-notes.mjs`,
    `verify-i18n.mjs`, `evals-compa.mjs`, `cobertura-conector.mjs`) y `postbuild` — verdes.
  - `npx ng test` — 279/279 tests (Vitest, incluye los nuevos parsers de import de WhatsApp y
    de resaltado de fragmentos FTS).
  - `npm run test:edge` (Deno) — 171/171 tests (incluye la firma HMAC del Contrato, la
    heurística de pre-filtro de wa-extract, el validador de hallazgos, el chequeo de
    presupuesto diario y el de latido caído).
  - `node scripts/evals-compa.mjs` — 43/43 (incluye el guard nuevo de las 4 herramientas de
    WhatsApp: existencia, permiso granular que realmente oculta la herramienta, que
    `resumen_grupo_whatsapp` nunca puede mezclar dos grupos, y las advertencias de
    no-confiar-en-el-dato/no-falsa-certeza en las descripciones).
  - Migración `sql/2026-11-05-db2-whatsapp-grupos.sql` aplicada a **dev** y verificada por
    objeto (cada tabla/función/bucket consultado directamente, no solo "la migración no dio
    error") — incluye una prueba real de idempotencia de `wa_hallazgo_insertar` (segunda
    llamada con los mismos datos → no duplica) y de `wa_importar_mensajes` (simulando un JWT de
    admin real en una transacción con rollback: primera importación inserta 2 filas, reimportar
    el mismo contenido inserta 0).
  - Edges `wa-ingest` y `wa-extract` desplegados a **dev**. `WA_SHARED_SECRET` aplicado en dev
    (OK explícito de Xaviel: "hazlo, no importa que tenga un costo, hay que hacerlo").
  - `node scripts/smoke-wa-ingest.mjs --env dev --con-ia` — **corrido con el secreto ya en vivo,
    05-nov-2026. 10/10 verificaciones OK** (completado en dos pasadas: la 1.ª cerró 9/10, la 2.ª
    — tras dar de alta temporalmente un teléfono de prueba en `whatsapp_autorizados` — cerró la
    décima): firma inválida → 401, replay (timestamp viejo) → 401, `config` responde defaults,
    mensaje nuevo se acepta, mismo `wa_message_id` repetido NO duplica, grupo en modo `ignorar`
    NO guarda el mensaje, DM no autorizado responde cortés sin llamar a Claude (y al repetirse
    dentro de 24h correctamente se silencia — throttle confirmado), heartbeat actualiza
    `wa_listener_estado`, latido viejo (>10min) dispara alerta y registra
    `listener_latido_caido` en `wa_eventos`, **DM de un teléfono autorizado llega de verdad a
    `assistant`** (aviso de primer uso + respuesta real de Compa), y una conversación sintética
    de ejemplo ("mañana a las 8am llega el camión con 50 sacos de cemento para Torre Alpha,
    RD$12,500") pasó por `wa-extract` real y produjo **2 hallazgos correctos** (`pedido_material`
    y `acuerdo`, resumen correcto en ambos). El teléfono de prueba y todas las filas que generó
    (`whatsapp_autorizados`, `whatsapp_conversaciones`, `whatsapp_mensajes`) se borraron después
    — dev queda limpio. Encontré y corregí 2 bugs menores EN EL PROPIO SCRIPT de smoke durante
    esta corrida (no en el código de producto): un insert por lotes con claves inconsistentes
    entre objetos (PostgREST `PGRST102`) y falta del header `Accept-Profile`/`Content-Profile:
    sgc` para apuntar al esquema correcto vía REST directo.

## Checklist manual — correr cuando el listener real esté pareado en dev

- [ ] Un mensaje escrito en un grupo de prueba (modo `memoria`) aparece en Tecnología › Compa en
      WhatsApp › Archivo en pocos segundos.
- [ ] Una nota de voz en ese grupo aparece transcrita (columna `transcripcion` / se ve en el
      Archivo) — requiere `STT_API_KEY` configurada.
- [ ] Una imagen en ese grupo queda guardada y, si hay modelo de visión disponible, con una
      descripción corta en español.
- [ ] Un mensaje con un acuerdo claro ("quedamos en traer X mañana") produce un hallazgo en la
      pestaña Hallazgos dentro de los ~4 minutos (ciclo de `wa-extract`).
- [ ] Ese hallazgo se puede "Convertir" en una tarea (o nota) desde la UI, y queda marcado como
      convertido solo cuando el usuario confirma (no antes).
- [ ] Un grupo puesto en modo `ignorar` deja de guardar mensajes nuevos (verificar que NO
      aparecen en Archivo).
- [ ] Un grupo en modo `consulta`: preguntarle algo que esté en el archivo de ESE grupo responde
      correctamente; preguntarle algo que solo está en OTRO grupo o en SGC NO lo responde (la
      regla dura de separación grupo↔privado).
- [ ] Un DM de un número en `whatsapp_autorizados` responde vía Compa con el aviso de primer uso,
      y respeta sus permisos reales de SGC.
- [ ] Un DM de un número NO autorizado recibe el mensaje cortés, sin consumir una llamada a
      Claude (revisar que no aparece una fila de `uso_ia` para ese intento).
- [ ] Apagar el proceso del listener → la alerta de latido caído (correo, y Telegram si está
      configurado) llega en ≤10 minutos; al reconectar, se registra la recuperación.
- [ ] El import de historial viejo (`.txt` de "Exportar chat") sube, se previsualiza, se estima
      el costo en tokens, y al confirmar los mensajes aparecen en el Archivo del grupo elegido
      (reimportar el mismo archivo no duplica).

## Pendiente antes de poder marcar este release como probado

1. Xaviel aplica `WA_SHARED_SECRET` en dev (`node scripts/aplicar-secret.mjs --env dev
   WA_SHARED_SECRET` — el valor generado está listo, ver reporte final / HANDOFF) y lo pasa al
   repo `csd-wa-listener`.
2. El listener se parea con un número de WhatsApp real (puede ser un número de prueba interno)
   y se agrega a 1-2 grupos de prueba.
3. Volver a correr `node scripts/smoke-wa-ingest.mjs --env dev` (y con `--con-ia` al menos una
   vez) para cerrar las 9 verificaciones automáticas que quedaron pendientes por el 503.
4. Recorrer el checklist manual de arriba.
5. Solo entonces: Xaviel da el OK explícito y se actualiza este archivo con la fecha y el
   resultado, igual que los releases anteriores.

- Versión de origen: 1.208.0.
- Fecha: 2026-11-05 (preparación — pendiente de prueba real).
