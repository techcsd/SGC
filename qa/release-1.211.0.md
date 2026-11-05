# Release 1.211.0 — WhatsApp: memoria de grupos y hallazgos con IA (ronda DB, PROMPT DB-2)

> Renumerado de 1.209.0 → 1.211.0 al mergear a `dev`: esa versión ya estaba tomada por otra
> ronda (DH, "Compa más estable...") que llegó a `dev` primero. Sin cambios de contenido más
> allá del número.

- Equipo/tester: PENDIENTE — este release todavía no tiene una prueba humana completa. El
  listener externo (`csd-wa-listener`, repo hermano) ya está pareado con un número real
  (829-619-1631) y ya se unió a un grupo de prueba (05-nov-2026), pero el checklist manual de
  abajo no se ha recorrido todavía.
- Qué verificó Claude Code (sin navegador humano):
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
  - Edges `wa-ingest` y `wa-extract` desplegados a **dev**. `WA_SHARED_SECRET` aplicado en dev y
    ya está en vivo en el `.env` del repo `csd-wa-listener`.
  - `node scripts/smoke-wa-ingest.mjs --env dev --con-ia` — corrido con el secreto en vivo,
    05-nov-2026, 10/10 verificaciones OK (firma inválida → 401, replay → 401, `config` responde
    defaults, mensaje nuevo se acepta, `wa_message_id` repetido no duplica, grupo `ignorar` no
    guarda, DM no autorizado responde cortés sin gastar IA y se auto-silencia dentro de 24h,
    heartbeat actualiza `wa_listener_estado`, latido viejo dispara alerta y registra
    `listener_latido_caido`, DM autorizado real llega a `assistant`, y una conversación
    sintética produjo 2 hallazgos correctos vía `wa-extract`). Datos de prueba limpiados después.

## Estado real en csd-wa-listener (05-nov-2026, post-pareo)

- Pareado con el número real, autenticado, y ya unido a un grupo de prueba
  (`120363435470643870@g.us`, modo `memoria`).
- Encontrado y corregido en el repo hermano durante el pareo real: `getChats()`/`getChatById()`
  de whatsapp-web.js falla de forma persistente contra la versión actual de WhatsApp Web
  ("No LID for user" — gap de compatibilidad conocido del lado de la librería, no de este
  código). Esto rompía el envío de respuestas (incluido el aviso de bienvenida al grupo); ya se
  endureció para que el indicador de "escribiendo"/visto no bloquee el envío real, pero el envío
  en sí puede seguir fallando hasta que la librería lo soporte. **La RECEPCIÓN y el archivo de
  mensajes no dependen de esa misma llamada y deberían seguir funcionando** — falta
  confirmarlo escribiendo en el grupo de prueba y revisando Tecnología › Compa en WhatsApp ›
  Archivo una vez esta rama esté desplegada en dev.

## Checklist manual — correr con el listener real pareado en dev

- [ ] Un mensaje escrito en el grupo de prueba (modo `memoria`) aparece en Tecnología › Compa en
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
      regla dura de separación grupo↔privado). **Bloqueado hasta resolver el envío ("No LID for
      user") del lado de csd-wa-listener.**
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

1. Resolver (o confirmar que no bloquea la recepción) el problema "No LID for user" al enviar
   mensajes de grupo desde `csd-wa-listener`.
2. Escribir en el grupo de prueba y confirmar que el mensaje llega a Tecnología › Compa en
   WhatsApp › Archivo.
3. Recorrer el resto del checklist manual de arriba.
4. Solo entonces: Xaviel da el OK explícito y se actualiza este archivo con la fecha y el
   resultado, igual que los releases anteriores.

- Versión de origen: 1.210.0.
- Fecha: 2026-11-05 (preparación — pendiente de prueba real).
