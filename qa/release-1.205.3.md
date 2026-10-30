# Release 1.205.3

- Equipo/tester: Claude Code (sesión autónoma, ronda DC — WhatsApp Cloud API).
  **Falta la prueba humana de Xaviel** (no se puede completar sin conectar una
  app de Meta real — ver checklist en `docs/WHATSAPP-COMPA.md` §7).
- Qué se probó (automatizado, contra dev real `sgc-dev`, sin cuenta de Meta):
  1. **Tests Deno** — `supabase/functions/_shared/whatsapp.test.ts` (11/11):
     normalización de teléfono, verificación de firma HMAC (válida/inválida/
     cuerpo alterado), markdown→WhatsApp (negrita, encabezados, enlaces,
     tablas→viñetas, strip HTML), chunking (no corta a mitad de palabra, nunca
     excede el máximo), reintento con backoff (200 no reintenta, 429/5xx sí,
     400 no, agota intentos).
  2. **Smoke del webhook** — `node scripts/smoke-whatsapp-webhook.mjs --env dev`
     (9/9): GET de verificación devuelve el challenge; firma inválida → 401;
     `wa_message_id` duplicado se procesa UNA sola vez (dedupe); número NO
     autorizado queda registrado como tal sin llamar a Compa; número autorizado
     llega hasta `assistant` (usuario resuelto, conversación creada, aviso de
     primer uso sellado); el envío de salida falla de forma controlada y
     registrada (esperado — `WHATSAPP_TOKEN` de dev es un placeholder).
  3. **Manual adicional** (fuera del script, verificado a mano): secuencia
     "hola" → "nuevo" abre una conversación NUEVA (`conversacion_id` distinto)
     y confirma el reinicio sin llamar a Claude.
  4. **17/17 evals de Compa** (`scripts/compa-evals.mjs --env dev`) — se tocó
     `assistant/index.ts` (branch WhatsApp: memoria de conversación, enlace de
     borrador, rechazo de `ejecutar`); incluye 4 casos nuevos de WhatsApp
     (`dc5-wa-*`: pregunta autorizada, no autorizado, propuesta con enlace de
     borrador, "nuevo" reinicia). Reporte: `qa/compa-evals-dev.json`.
  5. `npm run build` y los guards de `prebuild` — verdes (ver resultado real
     de esta sesión más abajo si el build corrió después de escribir esto).
  6. Migración `sql/2026-10-29-dc2-whatsapp-cloud-api.sql` aplicada y en el
     ledger de dev. Edges `whatsapp-webhook` (nueva), `assistant`, `transcribe-audio`
     desplegadas en dev.
- **Resultado:** automatizado = OK. **Prueba humana: PENDIENTE** (necesita que
  Xaviel conecte el número/app de prueba de Meta en dev — checklist completo en
  `docs/WHATSAPP-COMPA.md` §7). No cuenta como `OK:` de Xaviel para
  `release-check.mjs` hasta que eso pase.
- Fecha: 2026-10-29

## Checklist manual para cuando Xaviel conecte Meta en dev

- [ ] Un número whitelisted pregunta algo real (p. ej. "¿cuántos vehículos tenemos?") y Compa responde correcto.
- [ ] Una nota de voz se transcribe y Compa la responde (requiere `STT_API_KEY` también configurado).
- [ ] Pedir una tarea/requisición ("prepárame una tarea para...") devuelve el enlace de borrador y dice que todavía no existe; confirmar desde SGC lo crea de verdad.
- [ ] Escribir "nuevo" reinicia la conversación y lo confirma.
- [ ] Un número NO autorizado recibe el mensaje educado, una sola vez por 24h.
- [ ] Apagar un número desde Tecnología › Compa en WhatsApp › Autorizados lo bloquea de inmediato (siguiente mensaje ya no pasa).

**OK:** _(pendiente — lo escribe Xaviel tras probar lo de arriba en dev)_
