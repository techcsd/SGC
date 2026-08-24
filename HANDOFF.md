# HANDOFF — SGC

## TL;DR
Ronda AW (19–24 ago 2026) cerrada y **shipped a `main`** hasta **v1.95.0** (Vercel deploya solo). Se validó/limpió el combustible (AW3), se arregló el cronograma vacío (AW1), y se construyó **Compa** — el asistente de IA (AW4) con **v1 lectura + v2 acciones con confirmación**. **Lo único que falta para encender Compa: que Xavier ponga el secret `ANTHROPIC_API_KEY`** (sin él responde 503 amable, no rompe nada).

## Estado de versiones (todo en prod / main)
- **1.93.0** (`763150e`) — AW1/AW2/AW3 combustible + cronograma + groundwork IA.
- **1.94.0** (`5e6e66a`) — Compa v1 (solo lectura).
- **1.95.0** (`b2d44a6`) — Compa v2 (acciones con confirmación) + rename Tato→**Compa**.
- Migraciones AW aplicadas a prod (6): `sql/2026-08-24-aw3-*` (4), `-aw1-*` (1), `-aw4-asistente.sql` (1). Edge function `assistant` desplegada.

## Done this session
- **AW3 combustible (server-side):** tope de galones por capacidad de tanque (topes por clase configurables en `flota_config` + override `vehiculos.capacidad_tanque_gal`, margen 1.15) + banda de precio + confirmación de valores inusuales (`registrar_combustible_app` +`p_confirmado`). Causa raíz del 34,118 gal = **decimal perdido** (34.118). Cols de traza `invalidada/saneada/valor_original`. RPCs `sanear_echada`, `echadas_sospechosas`. Baseline/incentivo excluyen invalidadas.
- **AW3 limpieza (aprobada por Xavier):** corregí la echada del Canter (34118→34.118, ahora 16.97 km/gal óptimo), invalidé 2 del KIA (119/88 km/gal imposibles). Queda **1 borderline (37.38 km/gal KIA)** en el panel de Saneamiento por si Xavier la excluye.
- **AW2:** anomalía con dirección (bajo→mantenimiento, alto→`revisar_lectura` al que registró + supervisores). Promedios sanos (excluyen invalidadas/outliers) en web. Panel de Saneamiento (admin) + dashboard (costo/km, precio-vs-banda).
- **AW1 cronograma:** `listar_cronograma` ocultaba tareas `es_prueba` a no-admin → los proyectos de prueba salían vacíos. Fix: en proyecto de prueba, sus tareas se ven. Regla "vacío ≠ error" aplicada en la vista.
- **AW4 Compa (asistente IA):** edge function `supabase/functions/assistant/index.ts` (Claude Messages API + tool use, ejecuta tools con el JWT del usuario → hereda permisos). **v1**: 12 tools de lectura filtradas por módulos. **v2**: `proponer_tarea/requisicion/conduce` → borrador → tarjeta de confirmación → ejecuta el **mismo RPC** del flujo normal (`asignar_tarea_obra`, `crear_solicitud_material`, `crear_conduce_simple`) con sus validaciones (stock, elegibilidad AV1). Web: página `/asistente` (`src/app/pages/asistente/*`), servicio, ruta sin gate, menú+icono. Tablas `assistant_conversaciones/mensajes/acciones` (RLS own+admin, auditoría). Rate limit 60/h, prompt caching.
- **Doc:** `C:\developer\improvements\agosto 2026\imp 19082026\ASISTENTE-IA-GROUNDWORK.md` (4 inventarios).

## Pending — Claude puede hacer (próxima ronda)
1. **Compa v3 — app móvil (csd-app):** el mismo asistente en `C:\Users\xavie\Desktop\X Dev\dev2\csd-app` (misma edge function `assistant`), con notas de voz como entrada (AH13). Es PROMPT-10 territory.
2. **Más write tools:** hoy Compa prepara tarea/requisición/conduce. Agregar solicitud de movimiento (`crear_solicitud_movimiento`) y solicitud de compra.
3. **`generar_reporte_pdf`:** generalizar la edge `generar-informe-obra` (hoy solo informe de obra, email-only) a multi-reporte que devuelva el PDF — es el candidato del groundwork.
4. **RPC `resumen_combustible` saneada** (galones/gasto/rendimiento excluyendo prueba+invalidadas) como tool — hoy el dashboard lo calcula en el cliente.
5. Excluir (o no) la echada borderline **37.38 km/gal del KIA** — decisión de Xavier vía panel de Saneamiento.

## Pending — Xavier only (BLOQUEA Compa)
1. **Crear cuenta de Claude Platform (API)** en console.anthropic.com — **es aparte del Team plan** (el Team plan NO incluye API). Generar API key. Recomendado: budget alert ~US$50, aviso al 80%.
2. **Setear el secret `ANTHROPIC_API_KEY`** para las edge functions (Compa lee el secret en caliente, sin redeploy):
   - Dashboard: Supabase → proyecto → **Edge Functions → Manage secrets** → `ANTHROPIC_API_KEY`.
   - O CLI: `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref jeeqhgccqefbqilntcpu`
   - Opcional: `ASSISTANT_MODEL` para cambiar el modelo (default `claude-haiku-4-5-20251001`).
3. (Ya hecho por Xavier) Confía en Vercel para el deploy web automático al push de `main`.

## Gotchas descubiertos
- **Management API ≠ admin:** al correr SQL vía la Management API (`POST https://api.supabase.com/v1/projects/jeeqhgccqefbqilntcpu/database/query` con `SUPABASE_ACCESS_TOKEN`), `auth.uid()` es null y `sgc.is_admin()` = **false**. Los RPCs con guard `is_admin` fallan; para data-fixes usa **SQL directo** (rol de servicio, salta el guard).
- **Cambiar el tipo de retorno de una función** (ej. `clasificar_rendimiento` +columna `direccion`) exige `DROP FUNCTION` antes de `CREATE` (error 42P13). Los RPCs que la llaman por nombre no bloquean el drop (se recompilan).
- **`crear_conduce_simple` es un wrapper**: delega en `crear_conduce_transportista`. La forma de los ítems del conduce es `{articulo_id, cantidad}`; la de requisición es `{articulo_id, descripcion, cantidad, unidad, talla}`.
- **Edge functions:** `SUPABASE_URL`/`SUPABASE_ANON_KEY` están inyectadas por defecto. Para que las tools hereden permisos, crear el client con `{ global: { headers: { Authorization: authHeader } } }` (NO service role).
- **Supabase CLI** no está instalado global; usar `npx supabase@latest ...`. Docker no corre pero `functions deploy` no lo necesita.
- **Versionado (regla Y1):** cada bump necesita entrada en `release-notes.json` bajo `web.<version>` o el `prebuild` **falla**. El script Python que la inserta preserva UTF-8 con `ensure_ascii=False`.

## Verify on resume
```bash
cd "C:/Users/xavie/Desktop/X Dev/dev/SGC"
git log --oneline -3            # debe mostrar hasta b2d44a6 (1.95.0)
grep '"version"' package.json   # 1.95.0
# ¿está la key de Compa puesta? (si Compa da 503, falta ANTHROPIC_API_KEY)
npx supabase@latest secrets list --project-ref jeeqhgccqefbqilntcpu 2>/dev/null | grep -i anthropic || echo "FALTA ANTHROPIC_API_KEY"
```
