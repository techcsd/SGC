# AV5 + AV6 — Paridad web↔app: Conduces e Ingeniería (propuesta, ⚠️ Xaviel aprueba)

> Ronda AV · 24/08/2026 · Repo web `dev/SGC` @ 1.91.0 · **Inventario/propuesta primero, código después** (regla de la FASE 5/6).
> Coordina con la auditoría **AU1** (`AUDITORIA-ARQUITECTURA-AU1.md`): Inventario e Ingeniería están bajo consolidación, así que aquí **no se construye otro submódulo duplicado** — se decide el árbol una vez.
> Regla madre: la web es el **padre** y la app el **hijo**; toda capacidad de la app debe existir en la web. La paridad es **de capacidades**, no necesariamente de layout (la app puede agrupar; toda excepción se documenta — ⚠️ Xaviel valida este matiz).

---

## AV5 — Conduces en la web: tabla de paridad

Fuente web verificada por AU1 (Entregable 1.1). La app (csd-app, `dev2/`) no está en este repo: sus capacidades salen del contexto/rondas previas (wizard AU14, borradores AE9, firma despachante AS1, etc.) y **deben re-verificarse contra el repo de la app en PROMPT-8**.

| Capacidad (conduce) | App (hijo) | Web (padre) hoy | Veredicto |
|---|---|---|---|
| **Listar** conduces (activos/pend./por confirmar/histórico) | ✅ | ✅ `/inventario/conduces` (RPC `conduces_web_listado`) | **Paridad OK** |
| **Confirmaciones de entrega** (historial) | ✅ | ✅ `/inventario/confirmaciones` | **Paridad OK** |
| **Conduces por firmar** (bandeja despachante) | ✅ | ✅ `/inventario/por-firmar` (+ estado "corrección pendiente" AV1) | **Paridad OK** |
| **Conduces por implementar** (items libres) | ✅ (AY13) | ✅ `/inventario/conduces-por-implementar` | **Paridad OK** |
| **Material no catalogado** | ✅ (AU4) | ✅ `/inventario/material-no-catalogado` | **Paridad OK** |
| **Firmar como despachante** | ✅ (AS1) | ✅ `/inventario/por-firmar` (firma remota AV1) | **Paridad OK** |
| **Iniciar ruta / transferir** conduce | ✅ | ✅ (detalle conduce, AY) | **Paridad OK** |
| **Detalle / PDF / compartir** | ✅ (AL4/AO4) | ✅ `/salidas/:id/conduce` (`conduce_detalle_app`) | **Paridad OK** |
| **CREAR conduce** (wizard origen→destino→artículos→despachante→firmas) | ✅ (AU14) | ⚠️ **Parcial** — la web crea salidas/conduces **por almacén** (`registrar_salida_inventario` + `crear_conduce_simple`) desde `/inventario/salidas`, con selector de **receptor** (AT16) pero **sin selector de despachante en el wizard** (`getDespachantes()` existe pero está **sin cablear**). El wizard táctil completo de la app (elegir despachante, firma en sitio del chofer) no tiene equivalente 1:1 en la web. | **Brecha real de FASE 5** |
| **Borradores** de conduce (AE9) | ✅ | ❌ no hay | **Brecha (menor)** |

### Lectura del alcance (⚠️ confirmar con Xaviel)
La web **sí lista y opera** conduces (contra la hipótesis de que "no existen"). Lo que le falta es el **wizard de creación desde escritorio con selector de despachante** y, opcionalmente, borradores. Es decir: **crear/despachar completo desde la web**, no la lista.

### Propuesta de FASE 5 (cuando Xaviel apruebe alcance + AU1 ubique el hogar)
1. **Un solo hogar para crear conduce en la web** — según decida AU1 (P1/P2 unifican Salidas/Requisiciones/mecanismos de stock). NO agregar otro submódulo. Candidato natural: extender el wizard de `/inventario/salidas` con el **paso de despachante** reutilizando `despachantes_disponibles` (ya filtrado por la matriz AV1) y `getDespachantes()` (ya existe en el servicio, solo falta cablear).
2. **Reutilizar contratos, no reinventar:** mismos pasos (AU14), selectores con la elegibilidad de AV1/AV8/AU9, firmas AC7, diccionario de etiquetas AU15, `es_prueba`, PDF/compartir existentes.
3. **La web suma lo suyo:** crear desde escritorio con teclado (almacén/logística), sin clonar la UX táctil.
4. **Quién lo usa desde escritorio:** almacén/logística creando y despachando; oficina consultando. Priorizar esas vistas.
5. Al cerrar: marcar **conduces = primer dominio saldado** en la tabla de paridad global de AT6.

**⚠️ Decisiones para Xaviel (AV5):** (a) ¿el alcance es "crear + firmar + confirmar desde la web" o solo el wizard de creación? (b) ¿esperar a que AU1 ubique el hogar de Inventario, o construir el paso de despachante detrás de un feature flag ya?

---

## AV6 — Árbol de Ingeniería web ↔ app: descuadre y árbol canónico

### Estado real hoy (web, sidebar admin — 13 hijos bajo "Ingeniería")
Solicitud de movimiento · Nueva bitácora · Mis bitácoras · Dashboard de bitácora · Mi proyecto · Requisición · Confirmar entregas · Plan del día · No conformidades · Checklists de calidad · Subcontratistas · Avance y costos · Informe semanal de obra.
(AU6 ya movió la suite de Bitácora dentro de Ingeniería; "Bitácora" ya no es módulo de primer nivel.)

### Estado real hoy (app, según apunte — 2 items)
"Solicitud de material" · "Crear ruta". ⚠️ **Verificar contra el repo `dev2/csd-app`** (PROMPT-8).

### Diagnóstico
Es la **foto del estado intermedio de AT6 + AU6**: la web creó Ingeniería y absorbió módulos; la app quedó con su Ingeniería original de 2 items. La paridad de árbol (regla AT6) quedó rota **en la dirección app**.

### Las 3 dudas concretas del contexto — resueltas en la propuesta
1. **"Crear ruta" ¿es de Ingeniería o de Flota/Transporte?** → **Flota/Transporte.** Una ruta es transporte (vehículo, chofer, paradas, tracking). En la web vive en `/flota/rutas`. La app debe moverla a su grupo de Flota/Transporte, no a Ingeniería. Lo que Ingeniería sí origina es la **Solicitud de movimiento** (pide mover material), que un referente convierte en ruta — pero la ruta en sí es de Flota.
2. **"Requisición" y "Confirmar entregas" dentro de Ingeniería ¿choca con la consolidación de AU1?** → No, si se tratan como **accesos** al hogar único, no como hogares nuevos. AU1-P2 define un solo hogar de requisición (`/inventario/requisiciones`); el item "Requisición" de Ingeniería (hoy `/bitacora/solicitudes-material`) es el **acceso del ingeniero** a *sus* requisiciones (crear + ver las suyas). "Confirmar entregas" es el acceso del ingeniero a confirmar los conduces de **su** obra (reusa `/inventario/conduce`). Ambos QUEDAN como accesos, apuntando al mismo backend.
3. **"Solicitud de movimiento" (web) vs "Solicitud de material" (app) ¿son lo mismo?** → **NO.** Son dos flujos distintos con nombres confusos:
   - **Requisición** = `solicitudes_material` (pedir materiales al almacén). La app la llama **"Solicitud de material"**. **Unificar el nombre a "Requisición"** en ambos lados (o a "Solicitud de material" — ⚠️ Xaviel elige UN nombre; recomiendo **"Requisición"** porque es el término que ya usa la web y el negocio).
   - **Solicitud de movimiento** = `solicitudes_movimiento` (módulo NUEVO AY11: logística ingeniero→transporte, pedir mover algo de un punto a otro). Es su propia cosa; **se mantiene con ese nombre** en ambos lados.

### Árbol canónico propuesto (⚠️ Xaviel aprueba — coordinado con AU1-P4)
Espejo de la propuesta AU1-P4, con las 3 resoluciones anteriores:

```
Ingeniería  (módulo — mismo árbol de capacidades en web y app)
├── Requisición            ← acceso del ingeniero (crear/ver sus requisiciones); hogar único en Inventario (AU1-P2)
├── Solicitud de movimiento ← flujo logística AY11 (NO es la requisición)
├── Confirmar entregas      ← acceso del ingeniero a confirmar conduces de su obra
├── Bitácora                ← Nueva / Mis bitácoras / Dashboard (suite AU6; la app puede agruparla en 1 entrada con pestañas)
├── Producción de obra      ← Plan del día · Avance · No conformidades · Checklists de calidad · Subcontratistas
├── Informe semanal de obra
└── Mi proyecto

Flota / Transporte
└── Crear ruta / Rutas      ← "Crear ruta" MIGRA aquí desde Ingeniería en la app (es transporte)
```

### Criterio de paridad (⚠️ validar el matiz con Xaviel)
- **Paridad de capacidades, no de menú.** La app puede **agrupar** (p. ej. la suite de bitácora como una sola entrada con pestañas) mientras la **capacidad** exista en ambos lados. Toda excepción (vista web-only por diseño) se **documenta** aquí.
- El usuario de la app es gente de obra con el sol en la pantalla: menú plano de 13 items no aplica; agrupar es correcto.

### Al aplicar (checklist AU6(c) — cuando Xaviel apruebe)
Rutas viejas con **redirect** · **permisos conservados** (nadie pierde ni gana acceso) · **badges** que suman al padre · **deep-links** de pushes/correos vivos · **layout por scope** (AK2/AJ4) · contratos para la app en **PROMPT-8 FASE 3** · actualizar la tabla de paridad de AT6.

**⚠️ Decisiones para Xaviel (AV6):** (a) ¿aprobar el árbol canónico de arriba? (b) ¿nombre unificado de la requisición = "Requisición"? (c) ¿"Crear ruta" se mueve a Flota en la app? (d) ¿la app puede agrupar (paridad de capacidades) o exiges el mismo menú?
