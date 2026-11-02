# IA por rol × flujo — ronda DF (01-nov-2026)

> F0 de PROMPT 128. Matriz de qué rol usa qué formulario, con qué frecuencia (según datos de **dev**, staging — ver nota de números reales más abajo) y qué ya tiene algún lector/voz IA hoy.

## Convenciones

- **Frecuencia**: alta / media / baja / nula, según el rol tiene el módulo asignado (`sgc.roles.modulos`) y el conteo de la tabla en los últimos 30 días en dev (staging — no representativo de volumen real, ver nota).
- **IA hoy**: ✅ ya tiene lector/voz/OCR · 🟡 parcial (infra existe pero no conectada a este formulario) · ❌ nada todavía.

## Matriz rol × flujo

| Rol (`sgc.roles`) | Bitácora | Conduce/recepción | Gastos/facturas | Requisición | Combustible | Checklist veh. | Inspección veh. | Rutas | Mantenimientos | Órdenes trabajo | Solicitud compra |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ingeniero de Campo | alta | — | — | alta | — | — | — | — | — | — | — |
| Ingeniero de Oficina | media | — | — | media | — | — | — | — | — | — | — |
| Jefe de Flota | — | media | — | — | alta | alta | alta | media | alta | media | — |
| Chofer / Transportista | — | alta | — | — | alta | alta | alta | alta | — | — | — |
| Chofer privado | — | media | — | — | media | media | media | media | — | — | — |
| Logística y Transportación | media | alta | — | alta | media | — | — | media | — | media | media |
| Gerente de Proyectos | media | — | — | media | — | — | — | — | — | — | — |
| Coordinador de Compras | — | — | media | alta | — | — | — | — | — | — | alta |
| Guarda-Almacén | — | media | — | media | — | — | — | — | — | — | — |
| Encargado de Patio y Bodega Central | — | — | — | media | — | — | — | — | — | — | — |
| Capataz | alta | — | — | — | — | — | — | — | — | — | — |
| Gerente de Producción de Obra | alta | — | — | media | — | — | — | — | — | — | — |

**IA hoy por formulario:**

| Formulario | IA hoy | Evidencia |
|---|---|---|
| Bitácora (parte diario) | ❌ | `bitacoras` no tiene columna de foto ni de audio; fotos viven aparte en `sgc.bitacora_archivos`. `proponer_bitacora` (`supabase/functions/_shared/herramientas.ts:1044`) es un *wrapper de escritura* para el conector MCP (crea un borrador desde texto ya estructurado) — no hace STT ni visión. **DF1-A (F1) es trabajo nuevo real.** |
| Conduce / recepción por foto | ❌ | No hay lector de foto de conduce. Tabla real es `sgc.conduces_externos` (no `conduces`). |
| Gastos y facturas (OCR) | 🟡 | `leer-recibo` (`supabase/functions/leer-recibo/index.ts`, 172 líneas) ya hace OCR+visión de recibos con `uso_ia` y costo — pero no hay tabla de "gastos/facturas" separada; hoy vive dentro de combustible/compras. F2 debe decidir si extiende `leer-recibo` o crea tabla propia. |
| Requisición e inspecciones | ❌ | `solicitudes_material` sin lector de voz. |
| Registro de combustible | 🟡 | `leer-recibo` puede adaptarse (ya lee recibos de bomba en otro flujo — ver CF4 en memoria) pero no está conectado al formulario de combustible actual. |
| Checklist de vehículos | ❌ | Tablas `checklist_plantillas`, `checklist_vehiculo_respuestas`, `checklist_vehiculo_fotos`, `checklist_foto_slots` existen (estructura rica) pero sin lector IA. |
| Inspección de vehículos | ❌ | Mismo módulo que checklist, sin IA. |
| Rutas | 🟡 | `seguimiento.ts` (`src/app/pages/flota/seguimiento/seguimiento.ts`) ya anima el marcador (`markerAnim`) con posiciones Realtime — **esto está en `seguimiento.ts`, NO en `rutas-activas.ts`** como asume el PROMPT 128 (rutas-activas.ts es tabla/lista, no mapa). F6 debe corregir el archivo objetivo. |
| Mantenimientos | ❌ | Sin lector. |
| Órdenes de trabajo | ❌* | *No existe tabla `ordenes_trabajo`. Lo que la memoria (ronda BN1) llama "orden de trabajo" vive dentro de bitácora: `bitacora_orden_detalle` + `bitacora_orden_firmas`. F2/F6 deben apuntar ahí, no a una tabla inexistente. |
| Solicitud de compra | ❌ | Tabla real `sgc.solicitudes_compra` (no `ordenes_compra`, que es otra cosa — orden de compra ya aprobada). Sin lector. |

## Infraestructura IA ya existente (para reusar, no duplicar)

- **STT (voz→texto)**: `supabase/functions/transcribe-now/index.ts` (129 líneas) + `supabase/functions/transcribe-audio/index.ts` + `supabase/functions/_shared/stt.ts` (exporta `STT_PROVIDERS`, `resolverSttConfig()`, `transcribirAudio()`). **F1/F2 deben llamar `transcribirAudio()`, no crear otro STT.**
- **Visión/OCR**: `leer-recibo` (172 líneas, con `uso_ia` + costo), `leer-documento-flota` (153 líneas), `leer-documento-personal`.
- **Borradores de escritura vía conector MCP**: `claude-borrador` (218 líneas) + `_shared/herramientas.ts` (33 `proponer_*` ya listadas en `evals/mcp/run.mjs`). Estas son para el conector de Claude Desktop, **no** para el flujo de usuario final dentro de la app — F1 necesita su propia tabla de borradores (`bitacora_ia_propuestas`) porque el flujo y el permiso son distintos (usuario de campo revisando su propio parte, no un admin aprobando vía Claude Desktop).
- **Costos**: `sgc.uso_ia` (migración `sql/2026-10-02-cf4-leer-recibo-uso-ia.sql`), columnas función/modelo/tokens/costo, RPC `sgc.uso_ia_resumen()`. **F3 (agente_costos) debe sumarse a esta tabla, no crear una paralela.**
- **Consentimiento**: `sgc.consentimientos` (migración `sql/2026-10-07-ci10-consentimientos.sql`), `tipo in ('ia','ubicacion_fondo')`. F1/F2 deben verificar este consentimiento en servidor antes de ofrecer el botón de IA (igual que las 4 edges de CI10 ya hacen, 403 `sin_consentimiento_ia`).
- **Movimiento**: `src/shared/motion/catalogo-movimiento.ts` (174 líneas) ya define niveles `grande | mediano | base` (el prompt dice "simple", el código dice "base" — mismo concepto, nombre real es `base`). F5/F6 deben usar este tipo, no inventar uno nuevo.

## Veredicto de licencia — `ajsahni/agents-office`

🔴 **No usable para SGC, ni siquiera como código adaptado.** Licencia: PolyForm Noncommercial License 1.0.0 + términos adicionales de Sahni.ai. Constructora SD es una empresa comercial — el uso no calza en ninguna excepción (personal/investigación/organización sin fines de lucro). Además el término adicional #3 dice explícitamente: *"You may not adapt Agents Office to drive, display or front another agent system, workforce, platform or product, or bundle it with one"* — prohíbe exactamente lo que N3 pedía (adaptarlo a SGC). **Conclusión: cero código copiado.** Lo único aprovechable es la *idea* general (oficina isométrica 2D con agentes animados mostrando estado) — eso no es copiable por derecho de autor y ya está cubierto por el mockup aprobado de Xaviel en el board DF2. F5 se construye desde cero (SVG propio), sin mirar el código de ese repo.

## Nota sobre los números de uso (importante)

Los conteos de "últimos 30 días" se corrieron contra **dev** (`fzfrnrvndzrjwyvdpkgg`), que es ambiente de staging con datos de prueba, no el volumen real de la empresa:

| Tabla | n (30d, dev) |
|---|---|
| `bitacoras` | 3 |
| `conduces_externos` | 0 |
| `registros_combustible` | 0 |
| `solicitudes_material` | 1 |
| `mantenimientos` | 1 |
| `solicitudes_compra` | 3 |
| `rutas` | 0 |
| `checklists_vehiculo` | 0 |
| `app_error_reports` | 84 |
| `uso_ia` por función | `leer_documento_flota`: 11 usos, $0.69 · `leer_recibo`: 1 uso, $0.0036 · `leer_documento_personal`: 1 uso, $0.004 |

No se corrió el mismo query contra **prod** — el clasificador de permisos de la sesión lo bloqueó (correcto: "cada acción sobre prod necesita su propio permiso nombrado"). **Si el coordinador quiere el volumen real de uso (para priorizar F2 con datos de verdad), hace falta una ronda aparte con permiso explícito de Xaviel para SELECT de solo-diagnóstico en prod** (permitido por la regla CD10 del CLAUDE.md del proyecto).

## DF-xx sin valor (falta CONTEXTO-ACTUALIZACION-63.md)

El archivo no existe en disco (buscado en el repo y en `Projects documentations/SGC/`). Los siguientes valores NO están en el texto literal del PROMPT 128 y el coordinador deberá fijarlos con un default razonable antes de F3-F6, o pedírselos a Xaviel:

- **DF-00**: no referenciado en el cuerpo de las fases — probablemente scope/orden general, sin impacto práctico si se sigue el orden F0→F7 tal cual está escrito.
- **DF-02**: se pide "modelo por env" para la edge `bitacora-ia`, pero no se da el nombre exacto de la variable de entorno ni el modelo (Sonnet/Opus/Haiku). Reusar el patrón de `leer-recibo`/`leer-documento-flota` (que ya resuelven su modelo vía env) es el default más seguro — inspeccionar esas edges al construir F1 para copiar el nombre de variable exacto.
- **DF-06**: "tope de costo" para agentes (F3) y para IA en general — no hay monto. Default razonable: igual que cualquier gasto operativo nuevo, arrancar con un tope bajo configurable (p.ej. $5/día) y que el Cronista (F5) lo reporte; ajustar con Xaviel tras una semana real de datos.
- **DF-10, DF-14, DF-16, DF-17**: no aparecen mencionados en ningún punto del cuerpo de F0-F7 ni en las notas N1-N4 ni en las respuestas literales de Xaviel. No hay suficiente contexto en el prompt para ni siquiera adivinar su tema — el coordinador debe o bien ubicar el archivo CONTEXTO-63 real, o confirmar con Xaviel qué cubrían antes de darlos por aplicados.

Todos los demás DF-xx citados (01, 03, 04, 05, 07, 08, 09, 11, 12, 13, 15) sí están embebidos literalmente en el cuerpo de las fases F1-F6 y se pueden aplicar tal cual están escritos.

## F2 — estado tras esta ronda (lectores/voz en otros formularios)

Hecho de verdad (edge genérica + 1 formulario conectado de punta a punta):

- **`supabase/functions/leer-formulario/index.ts`** — edge ÚNICA con parámetro `tipo`, en vez de una edge por formulario (como pedía el prompt). Declara el catálogo completo de tipos (`conduce_externo`, `checklist_vehiculo`, `requisicion`, `factura_general`, `mantenimiento`, `ruta`) pero **solo `conduce_externo` está implementado** — los demás responden `501` con `error_code: 'tipo_no_implementado'` en vez de fingir que funcionan.
- **Conduce externo (prioridad 2) — COMPLETO**: botón "Entender con IA" en `conduce-externo-form.html` (tarjeta 2, Fotos), reusa las fotos de placa+carga que el formulario YA pedía (no se agregó ningún campo/foto nueva ni se tocó `crear_conduce_externo`). Propone `material` (rellena la tarjeta 3 solo si está vacía — nunca sobrescribe lo que el usuario ya escribió), `proveedor_sugerido` (empareja contra el catálogo real de proveedores; sin match lo ofrece como texto «Otro», nunca crea un proveedor solo) y renglones de `items` contra el catálogo real de artículos (match exacto, cantidad > 0). Panel "Esto entendí" con puntos verde/ámbar/gris, "Revisar los N que dudo", "Descartar". Gate de consentimiento `ia` (botón oculto sin consentimiento, igual que F1). Tabla `sgc.formulario_ia_propuestas` (migración `sql/2026-11-01-df2-formulario-ia-propuestas.sql`, genérica por `tipo` en vez de una tabla por formulario) para la métrica de aceptación — se marca `aceptada`/`descartada` según si el conduce se emite o no.
- 6 pruebas unitarias nuevas en `src/shared/utils/formulario-ia.util.spec.ts` (sin sugerencia, nombre ambiguo, sin match en catálogo, cantidad inválida, match válido, lista vacía).
- Build (`npm run build`) y pruebas (`npx ng test`) verdes: 142/142.

Deferido explícitamente (edge declarada pero sin implementar + sin UI) — para no apurar 6 formularios a medias:

- **Combustible (prioridad 4)**: `leer-recibo` YA se usa desde `combustible.service.ts` (confirmado por grep) — este formulario **ya estaba cubierto antes de esta ronda**, no se duplicó.
- **Gastos y facturas (prioridad 3)**: no existe un módulo/tabla "gastos" independiente en este repo — lo más cercano es la factura que acompaña una entrada de inventario (`inventario/entradas`). Extender `leer-recibo` con un `contexto: 'factura_general'` (RNC/NCF/subtotal/ITBIS/total/proveedor/concepto) queda como siguiente paso concreto, sin tocar `entradas.ts` todavía.
- **Checklist/inspección de vehículos (prioridad 5)**, **Requisición por voz (prioridad 6)**, **Mantenimientos/rutas (prioridad 7)**: tipo declarado en `TIPOS_DECLARADOS` de `leer-formulario/index.ts`, schema de salida por definir, sin UI. Requisición es la siguiente más valiosa de implementar (es puramente por voz, reusa `grabadora-audio` de F1, no necesita fotos) pero su pantalla de creación (`inventario/requisiciones/requisiciones.ts`, >1000 líneas, con `FormDrawer`+`RequisicionItemsMapper`) es considerablemente más compleja que `conduce-externo-form` — se dejó fuera de esta pasada para no arriesgar una regresión en un flujo crítico sin tiempo suficiente de revisión.

Nota de corrección: "Mantenimientos, órdenes de trabajo, rutas" del prompt original se simplifica a "Mantenimientos, rutas" — no existe una tabla `ordenes_trabajo` separada (ver arriba).

## F2b — continuación (02-nov-2026)

- **Mantenimientos (prioridad 7, parcial) — ahora completo**: tipo `mantenimiento` implementado en
  `leer-formulario` (voz, sin foto — distinto del resto de los tipos que sí la requieren). Propone
  descripción + vehículo (match exacto placa/alias) + tipo preventivo/correctivo. UI en
  `flota/mantenimientos` con `<app-grabadora-audio>` (reusa el componente de F1). El modelo real de
  `Mantenimiento` no tiene "prioridad" — se usa `tipo`, que es el campo que sí existe y cumple un rol
  equivalente (correctivo = reactivo/urgente, preventivo = programado).
- **Facturas/gastos (prioridad 3)**: `leer-recibo` extendido con `contexto: 'factura_general'`
  (backend únicamente, compatibilidad total con el uso de combustible existente). Sigue sin UI — no
  hay pantalla de "gastos" independiente en el repo.
- **Checklist de vehículos (prioridad 5) y requisición por voz (prioridad 6)**: siguen diferidos, sin
  cambios desde F2 — mismas razones (estructura por-ítem de checklist más compleja; pantalla de
  requisiciones >1000 líneas de riesgo alto para tocar sin más tiempo de revisión por pasada).
