# Propuesta — Transcripción automática de notas de voz (AA22) ⏸

> PROMPT-9 · FASE 6. **Requiere aprobación de Xaviel antes de implementar.** Este documento investiga proveedores de speech-to-text usables desde una edge function Deno, estima el costo con el volumen actual y recomienda uno.

---

## 1. Volumen actual (medido en prod, 29/07/2026)

- `sgc.audio_notas`: 2 filas (infra recién estrenada).
- Archivos de audio en Storage: **11 en `sgc-bitacora`** + **2 en `flota-documentos`** = ~13 archivos.
- El sistema de voz es **muy nuevo**; el volumen real será el que genere el uso diario de la app (notas de voz en incidentes, bitácora paso 6, fallas de reporte semanal — AA9/AA13).

**Estimación de régimen:** aun asumiendo un uso agresivo — p. ej. 50 notas de voz/día × 45 s promedio = **~37.5 min/día ≈ 1,125 min/mes**. Es un volumen bajo para cualquier proveedor STT.

---

## 2. Proveedores evaluados (STT desde edge function Deno)

Todos exponen un endpoint HTTP REST que una edge function Deno puede llamar con `fetch` (multipart o URL del archivo) usando una API key como secret. Comparación centrada en **español dominicano**, costo, simplicidad y privacidad.

| Proveedor | Modelo | Costo aprox. (USD/min) | Español RD | Simplicidad desde Deno | Privacidad | Notas |
|---|---|---|---|---|---|---|
| **OpenAI** | `gpt-4o-mini-transcribe` | **~$0.003/min** | Muy bueno (multilingüe, buen manejo de acentos) | REST simple (`/v1/audio/transcriptions`, multipart) | No entrena con datos de API (retención 30 d, opt-out ZDR disponible) | Mejor relación calidad/precio/simplicidad |
| OpenAI | `whisper-1` | ~$0.006/min | Muy bueno | Igual | Igual | El clásico; `gpt-4o-mini-transcribe` lo supera en precio y calidad |
| Deepgram | `nova-2` (es) | ~$0.0043/min | Bueno | REST simple, acepta URL | Retención configurable | Rápido; bueno para tiempo real (no lo necesitamos) |
| Groq | `whisper-large-v3-turbo` | ~$0.0007/min (muy barato) | Muy bueno (Whisper) | REST estilo OpenAI | Sin garantía ZDR formal | El más barato; API compatible OpenAI |
| Google STT | `chirp` / v2 | ~$0.016/min (0–500k min) | Bueno | Requiere GCP auth (OAuth/service account) — **más fricción desde Deno** | GCP DPA | Más caro y más setup |
| AssemblyAI | universal | ~$0.0037/min | Bueno | REST simple (subir URL) | Retención configurable | Extras (diarización) que no necesitamos |

---

## 3. Costo mensual estimado (con el volumen de régimen ~1,125 min/mes)

| Proveedor | Costo/mes estimado |
|---|---|
| Groq whisper-large-v3-turbo | **~$0.80/mes** |
| OpenAI gpt-4o-mini-transcribe | **~$3.40/mes** |
| Deepgram nova-2 | ~$4.80/mes |
| OpenAI whisper-1 | ~$6.75/mes |
| Google STT v2 | ~$18/mes |

Incluso en el escenario agresivo, el costo es **marginal** (< $5/mes con la opción recomendada). Con el volumen actual real (~13 archivos) es prácticamente $0.

---

## 4. Recomendación

**OpenAI `gpt-4o-mini-transcribe`** como opción principal:
- Mejor calidad en español con acento dominicano entre las económicas.
- API REST trivial desde Deno (`multipart/form-data`, una sola llamada), igual patrón que ya usamos para otras integraciones.
- Precio marginal (~$3–4/mes en régimen alto).
- Anthropic/OpenAI: sin entrenamiento con datos de API; retención corta; se puede pedir ZDR si Xaviel lo requiere por privacidad.
- **Alternativa ultra-barata:** Groq (API compatible con OpenAI → cambiar solo `baseURL` + key) si el costo llegara a importar; calidad Whisper-large. Se puede dejar el proveedor **configurable por secret** para cambiar sin redeploy.

> Xaviel ya usa Resend y tiene el patrón de secrets en Vault + edge functions; agregar una key de OpenAI sigue el mismo camino (se guarda como secret del proyecto, nunca en el repo).

---

## 5. Diseño técnico propuesto (para implementar tras aprobación)

Genérico **por adjunto de audio**, no por módulo — sirve para incidentes, bitácora paso 6 (AA9), fallas de reporte semanal (AA13) y lo que venga.

1. **BD (aditivo):** en `sgc.audio_notas`:
   - `transcripcion text`
   - `transcripcion_estado text default 'pendiente'` ∈ (`pendiente`, `procesando`, `completada`, `fallida`, `omitida`)
   - `transcripcion_intentos int default 0`, `transcripcion_error text`, `transcrito_at timestamptz`.
   - Índice de texto (`to_tsvector('spanish', transcripcion)`) para búsqueda donde tenga sentido (historial de bitácoras/incidentes).
   - *(Nota: la bitácora guarda audio en `bitacora_archivos`, no en `audio_notas`. Como parte de esto se evaluará unificar la captura de la bitácora en `audio_notas` — que ya admite `entidad_tipo='bitacora'` — para que la transcripción sea realmente transversal. Decisión a confirmar al implementar.)*
2. **Edge function `transcribe-audio`** (Deno, service-role, schema `sgc`, secret `OPENAI_API_KEY` o `STT_API_KEY` + `STT_PROVIDER` configurable):
   - Recibe `{ audio_nota_id }` (o barre pendientes). Marca `procesando`, baja el archivo del bucket (signed URL), lo manda al STT, guarda `transcripcion` + `completada`, o `fallida` con reintento acotado (máx. 3).
   - CORS + `x-sync-secret` como las demás edges; `verify_jwt=false` (invocada por cron/servidor).
3. **Disparo:** dos opciones (elegir al implementar):
   - **(a) Cola/cron:** `pg_cron` cada N minutos barre `audio_notas` con `transcripcion_estado='pendiente'` y hace `net.http_post` a la edge (patrón idéntico a `check-domains`/cronograma). Robusto y desacoplado. **Recomendado.**
   - (b) Trigger al `insert` de `audio_notas` que dispara la edge — más inmediato pero acopla el guardado al STT.
4. **UI (web y app):** junto al `<audio>` player del historial, mostrar la transcripción (o "Transcribiendo…" / "No se pudo transcribir"). Botón **"Transcribir"** on-demand para audios viejos o fallidos. Buscador que incluya la transcripción donde aplique.
5. **Verificación:** nota de voz nueva → transcripción visible en < X min; una vieja se transcribe on-demand; un fallo reintenta y no bloquea nada.

---

## 6. Qué necesito de Xaviel para arrancar

1. **Aprobación del proveedor** (recomendado: OpenAI `gpt-4o-mini-transcribe`; alternativa Groq).
2. La **API key** del proveedor elegido (la pone como secret del proyecto Supabase — `supabase secrets set` o Vault —, nunca en el chat ni en el repo).
3. Confirmar el **disparo** (recomiendo cron/cola) y si quiere unificar la captura de audio de la bitácora en `audio_notas`.
