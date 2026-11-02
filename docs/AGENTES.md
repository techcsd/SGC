# Agentes (ronda DF, 01-nov-2026)

Seis agentes automáticos monitorean y mejoran SGC y CSD App. Viven en
Tecnología › Agentes (`/tecnologia/agentes`, gate `tecnologiaGuard` —
admin o `sgc.es_tecnologia()`, igual que QA/Issues/monitoreo). Esquema en
`sql/2026-11-01-df2-agentes.sql`, `sql/2026-11-01-df3-agentes-aprobaciones-cronista.sql`.

## Los 6 agentes

| Agente | Nivel máximo | Qué hace hoy |
|---|---|---|
| Vigía | 2 | Cron cada 5 min, 100% determinista. Reintenta transcripciones atascadas, recuerda envíos atascados, abre reporte de soporte por error repetido. |
| Capataz | 2 | Hallazgo: obras activas sin bitácora hoy (solo detecta, no actúa — ninguna acción Nivel 2 cerrada le aplica todavía). |
| Soporte | 2 | Hallazgo: reportes de usuario sin respuesta +48h (solo detecta). |
| Auditor | 1 | Solo observa: tablas `sgc.*` con RLS activado sin ninguna política. |
| Escriba | 3 | Propone código vía PR a `dev` cuando se le pide. Nunca actúa sin tu OK, nunca mezcla a `main`. |
| Cronista | 1 | Arma el informe diario 6:30pm RD (SGC + CSD App). Se guarda siempre; se envía con un clic tuyo, nunca solo. |

## Niveles — qué puede hacer cada uno

- **Nivel 1 (detectar y avisar)**: inserta en `agente_hallazgos` / notifica. Nunca escribe sobre datos de negocio.
- **Nivel 2 (actuar y poder deshacer)**: solo las 4 acciones de la lista CERRADA en `sgc.agente_acciones_permitidas` (DF-09):
  1. `reintentar_transcripcion_atascada`
  2. `recordar_firma_conduce` (mensaje normal del sistema, vía `sgc.notificar`)
  3. `abrir_reporte_soporte`
  4. `reiniciar_envio_atascado` (en la práctica: recordatorio — un outbox local no se reinicia desde el servidor)

  **Prohibido explícitamente, para siempre**: tocar bitácoras, inventario, conduces o dinero. Agregar una acción nueva a esta lista requiere una migración explícita y revisión — nunca se agrega "de paso".

- **Nivel 3 (proponer código)**: solo el Escriba. Flujo: hallazgo → `agente-escriba-solicitar` (sanea evidencia, nunca manda instrucciones, solo datos) → GitHub Action → PR a `dev` → fila en `sgc.agente_aprobaciones` (`pendiente`) → Xaviel decide en el panel (Aprobar para dev / Ver cambios / Pedir ajuste / Descartar). **"Aprobar" nunca mezcla el PR** — solo marca el estado; el merge real a `dev` lo hace Xaviel en GitHub.

## Costo

Cada agente tiene un tope diario (`sgc.parametros.agente_costo_tope_diario_usd`, default $5/día — no había monto exacto en el prompt original por falta de CONTEXTO-63/DF-06, ajustable sin migración). `sgc.agente_bajo_tope(clave)` corta a comportamiento 100% determinista si se supera. El costo se mide en `sgc.uso_ia` (misma tabla que `leer-recibo`/`leer-documento-flota`, agrupado por `funcion = 'agente_<clave>'`) — no hay una tabla de costos paralela.

## Retención

`sgc.agente_eventos` se purga a los 14 días (DF-12), cron diario `agente-eventos-retencion`. `agente_hallazgos`/`agente_acciones`/`agente_aprobaciones` no se purgan (son la bitácora de lo que hizo cada agente).

## Pendiente de configuración física (Xaviel)

El Escriba (Nivel 3) no puede correr en vivo hasta que se agreguen:
1. GitHub → Settings → Secrets → Actions → `ANTHROPIC_API_KEY`
2. Supabase (dev primero) → Edge Functions → Secrets → `AGENTE_ESCRIBA_GITHUB_TOKEN` (PAT fine-grained, permiso "Actions: write" sobre `techcsd/SGC`)

Sin esos dos secretos, `agente-escriba-solicitar` responde `501 github_no_configurado` — el resto del sistema de agentes (Vigía/Capataz/Soporte/Auditor/Cronista) funciona igual, sin depender de esto.

## Lo que NO existe todavía (honesto, no a medias)

- Capataz/Soporte no ejecutan ninguna acción Nivel 2 (solo detectan) — ninguna de las 4 acciones cerradas les aplica tal como están definidos hoy.
- No hay cron fijo para Capataz/Soporte/Auditor (DF-07 lo deja abierto a "según necesidad"); se disparan manualmente por ahora.
- El panel no se comparó contra el mockup visual real (board DF2/DF3) — el enlace de artifact de claude.ai no es accesible para herramientas automáticas. Es una implementación honesta de la especificación de texto.
