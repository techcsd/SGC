# Compa — Suite de permisos por tool (AY §6)

> La lección de la fuga `mis_tareas`: declarar "hereda los permisos del usuario" no
> basta. Cada tool tiene aquí su **mecanismo de filtrado** y su **comportamiento
> esperado por rol**. Esta matriz es la vara: al agregar/cambiar un tool, se
> actualiza aquí y se re-verifica con los usuarios test de AY7 (`es_prueba`).

## Regla madre
- Tools `mis_*` → **identidad estricta** (`auth.uid()`), sin escape de módulo/admin.
- Tools de **gestión** (bandeja/KPIs de un módulo) → **módulo-scoped legítimo**: el
  usuario ve datos del módulo que posee, igual que al abrir la pantalla. No es fuga.
- El edge (`toolsParaUsuario`) filtra el tool por módulo → un rol sin el módulo **ni
  ve** la herramienta.
- `es_prueba`: los RPC de lectura ocultan datos de prueba salvo admin (o cuando el
  dato no lo marca). Gating es_prueba-por-actor: pendiente FASE 6 (usuarios.es_prueba).

## Matriz tool × mecanismo × esperado por rol

| Tool | RPC | Filtrado | admin | ingeniero (campo) | chofer | logística | usuario sin módulo |
|---|---|---|---|---|---|---|---|
| buscar_articulos | buscar_articulos | catálogo (ref), es_prueba=false | catálogo | catálogo | catálogo | catálogo | catálogo (tool sin gate) |
| mis_conduces_por_firmar | mis_conduces_por_firmar | despachante = uid | solo suyos | solo suyos | solo suyos | solo suyos | solo suyos |
| mis_conduces_pendientes_entrega | ídem | conductor/creador = uid | solo suyos | solo suyos | solo suyos | solo suyos | solo suyos |
| **mis_tareas** | **mis_tareas_asistente** | **asignado_a/por = uid (ESTRICTO)** | **solo suyas** | solo suyas | solo suyas | solo suyas | solo suyas |
| mis_proyectos | mis_proyectos | encargado = uid (admin: param) | los suyos | los suyos | los suyos | los suyos | los suyos |
| mis_rutas_hoy | mis_rutas_hoy | conductor(uid) hoy | suyas | suyas | suyas | suyas | suyas |
| mis_permisos | mis_permisos | uid (lo propio) | lo propio | lo propio | lo propio | lo propio | lo propio |
| buscar_usuarios | buscar_usuarios | directorio activos (≠uid) | directorio | directorio | directorio | directorio | directorio (nota: expone email — recortar futuro) |
| listar_almacenes | ubicaciones_almacen | módulo inventario | ✔ | si tiene inv. | tool oculto | si tiene inv. | tool oculto |
| despachantes_disponibles | despachantes_disponibles | módulo inventario | ✔ | si inv. | oculto | si inv. | oculto |
| requisiciones_pendientes | requisiciones_bandeja | módulo inv/compras (gestión) | todas | las visibles a su módulo | oculto | las de su módulo | oculto |
| resumen_proyectos (ficha) | kpi_proyectos | módulo proyectos/dirección | ✔ | (pend AY4) | oculto | oculto | oculto |
| log_combustible | log_combustible | módulo flota | ✔ | oculto | oculto | si flota | oculto |
| listar_vehiculos | flota_placas | módulo flota; es_prueba oculto | ✔ | oculto | oculto | ✔ (tiene flota) | oculto |
| vehiculos_en_uso | vehiculos_en_uso | admin/flota_elevado/tecnología | ✔ | oculto | oculto | según elevación | oculto |
| resumen_flota | resumen_flota | módulo flota (raise 42501) | ✔ | oculto | oculto | ✔ | oculto |
| mantenimientos_pendientes | mantenimientos_pendientes | módulo flota (raise 42501) | ✔ | oculto | oculto | ✔ | oculto |
| stock_por_almacen | inventario_almacen | puede_ver_inventario_bodega (raise 42501) | ✔ | según bodega | oculto | según inv. | oculto |
| articulos_bajo_minimo | articulos_bajo_minimo→inventario_almacen | ídem (hereda) | ✔ | según bodega | oculto | según inv. | oculto |
| movimientos_recientes | ultimos_movimientos_articulo | módulo inventario ([] si no) | ✔ | si inv. | oculto | si inv. | oculto |
| material_en_cuarentena (BG4) | material_en_cuarentena | módulo inventario; el RPC filtra POR BODEGA con puede_ver_inventario_bodega | ✔ | según bodega | oculto | según inv. | oculto |
| desempeno_semana | desempeno_semana→incentivo_listado | puede_gestionar_incentivos (admin/módulo incentivos) | ✔ | oculto | oculto | ✔ (AY6) | oculto |
| cronograma_de_obra | listar_cronograma | puede_ver_cronograma(obra) (raise 42501) | ✔ | su obra (pend AY4) | oculto | oculto | oculto |
| personal_de_obra | personal_obra_conteos | puede_ver_personal_obra(obra) ({} si no) | ✔ | su obra (pend AY4) | oculto | oculto | oculto |
| **cobertura_de_bitacoras** (BJ1) | bitacoras_cobertura_resumen | módulo bitácora/proyectos/dirección o admin/tec (raise 42501); cuenta TODAS las obras activas, incluidas las de 0 | ✔ | ✔ (tiene bitácora) | oculto | oculto | oculto |
| **actividad_de_usuario** (BE2) | actividad_de_usuario | **lo propio siempre; la de OTRO exige es_supervision_operativa (raise 42501)** | cualquiera | solo la suya | **solo la suya** | cualquiera (supervisión) | solo la suya |
| **rutas_del_dia** (BE2) | rutas_del_dia | supervisión → TODAS; resto → las suyas | todas | las suyas | las suyas | **todas** (supervisión) | las suyas |
| **disponibilidad_de_articulo** (BE2) | disponibilidad_de_articulo | **tool sin gate de módulo** (capacidades_asistente no escanea `obra`, así el ingeniero lo vería vacío); el RPC filtra POR BODEGA con puede_ver_inventario_bodega; apodos AU12; ambiguo→candidatos | ✔ | según sus obras (módulo obra) | ofrecido pero sin bodegas visibles → vacío | según inv. | ofrecido, vacío si no ve inventario |
| reportar_gap (BE2 · **CP3/CP9**) | registrar_consulta_no_atendida | ninguno (registra el gap, no lee datos). **CP3/CP9 (16-oct):** antes de aceptar, el edge compara `tema` contra nombre/descripción de las tools que el usuario SÍ tiene (`herramientaQueCoincide`) — si hay coincidencia, el gap se RECHAZA (no se registra) y se le dice al modelo qué tool usar. Caso real: Hector dijo "no tengo herramienta para listar almacenes" teniendo `listar_almacenes` — ahora ese gap no se habría registrado. | ✔ | ✔ | ✔ | ✔ | ✔ |
| **generar_reporte_pdf** (AY11/C2 · **CP3/CP9**) | varía por `tipo` (ver tools de lectura de cada uno) | sin gate de módulo propio (hereda el de la consulta que arma el reporte). **CP3/CP9 (16-oct):** acepta `bodega_ids[]` para `stock_almacen` (un PDF con una sección por almacén, o `separados:true` → uno por almacén); tipo nuevo `requisiciones` (mismos filtros que `listar_requisiciones`); **varios archivos por turno** (antes se pisaba uno solo — tope 20); fix de un bug real de pdf-lib que tumbaba CUALQUIER PDF con `″`/`′` (pulgadas/pies) en el nombre de un artículo. | ✔ | según el `tipo` pedido | según el `tipo` pedido | según el `tipo` pedido | solo tipos sin gate (ninguno hoy) |
| **listar_requisiciones** (CO6) | requisiciones_bandeja | módulo inventario/compras **o** rol `gerente_produccion`/`gerente_proyectos`/`jefe_ingenieros`/`ingeniero_oficina` (`puede_ver_todas_requisiciones`) | ✔ todas | ✔ (ingeniero_oficina SÍ, el de campo NO) | oculto | ✔ (tiene compras/inventario) | oculto |
| **leer_reporte_semanal_operaciones** (CO6) | reporte_semanal_operaciones_compa | tool sin gate de módulo; CADA sección reusa el gate de su RPC individual (inventario/compras/direccion/flota/bitácora/proyectos) y se salta con gracia (`secciones_omitidas`) si el rol no la ve | ✔ todas las secciones | según sus módulos (parcial) | solo lo que su rol vea (normalmente nada → todo en omitidas) | según sus módulos (parcial) | todo en `secciones_omitidas` |
| **buscar_en_internet** (CO6) | — (server tool nativo de Anthropic, `web_search_20250305`) | sin gate de módulo; apagable por `parametros.compa_web_search` (default `true`); tope de 5 búsquedas por CONVERSACIÓN (`assistant_acciones` donde `tool='web_search'`) además del `max_uses:3` por turno de Anthropic | ✔ | ✔ | ✔ | ✔ | ✔ (si el parámetro está encendido) |

| **mis_reuniones** (CP8) | mis_reuniones_compa | **identidad estricta** (organizador o participante = uid, SIN escape de módulo — corregido: una versión anterior usaba `reuniones_listado`, que para quien tiene el módulo `reuniones` trae TODA la empresa; eso rompe el contrato `mis_*`, la misma lección de la fuga `mis_tareas`) | solo suyas | solo suyas | solo suyas | solo suyas | solo suyas |
| **acuerdos_pendientes** (CP8) | reunion_acuerdos_pendientes_mios | **identidad estricta** (responsable_id = auth.uid()) | solo suyos | solo suyos | solo suyos | solo suyos | solo suyos |
| **resumen_reunion** (CP8) | reunion_resumen_compa | `puede_ver_reunion` por fila (participante/organizador/módulo/admin); busca por `tema` (texto libre, ilike sobre título) entre las reuniones visibles — si no hay pista, trae la próxima o la última pasada. No requiere resolver un id primero. | cualquiera visible | las suyas (participante/organizador) o todas si tiene el módulo | oculto salvo que participe | ✔ si tiene el módulo | oculto salvo que participe |

"oculto" = el tool no se ofrece (o el RPC devuelve vacío/raise → el edge traduce a
"no tengo acceso a eso").

## Escritura (borrador + confirmar)
proponer_tarea (tareas) · proponer_requisicion (inv/compras) · proponer_conduce (inventario).
La ejecución re-valida el módulo en el branch CONFIRMAR y corre la MISMA RPC del flujo
normal (un solo camino, AU1) → validaciones/elegibilidad idénticas.

## Cómo correr la suite (hasta tener AY7)
Manual, impersonando cada rol en la web y preguntándole a Compa las filas de arriba;
confirmar que ningún tool devuelve datos ajenos y que `es_prueba` no se filtra a un
usuario real. Con AY7 (usuarios test por rol), esto pasa a smoke reproducible por ronda.

## CS5 (19-oct-2026) — cobertura total: módulos que antes no tenían tool

Detalle completo (motivo de cada una, tabla por RPC) en `docs/CLAUDE-CONECTOR.md`
§11. Resumen de mecanismo de filtrado (regla madre de arriba):

| Tool | Mecanismo |
|---|---|
| `que_puedo_consultar` | Ninguno propio — refleja `sgc.tiene_modulo`/`sgc.is_admin` de TODOS los módulos, para que Claude sepa qué preguntar |
| `mis_notas`, `mis_mensajes`, `mis_reportes_soporte`, `mi_rendimiento` | **Identidad estricta** (`auth.uid()`), como manda la regla madre — sin escape de módulo |
| `listar_plantillas_documento`, `listar_expedientes_legales`, `listar_aprobaciones_legales`, `directorio_empleados`, `mis_ordenes_de_compra`, `mi_actividad_auditoria`, `listar_usuarios_admin` | **Módulo-scoped legítimo** — la RPC revalida el módulo/admin server-side (defensa en profundidad: no confía solo en que `toolsParaUsuario` ya filtró) |
| `mis_solicitudes_movimiento` | Reusa `solicitudes_movimiento_listar` (misma RPC de la pantalla real — RLS ya probada) |

`directorio_empleados` y `listar_usuarios_admin` **nunca** seleccionan
`salario`/contraseñas/PINs — verificado leyendo la definición de la RPC antes
de registrarla (regla 19), no solo confiando en el nombre.

## Vetos (§5) — NO existen ni se construyen
Tools de credenciales/API keys/configuración del sistema · escritura de permisos por
chat · ejecución de escritura sin confirmación · datos en archivos sin tool detrás.

## MCP (CR1) — el conector de Claude Desktop

El servidor `mcp` (`supabase/functions/mcp/`) usa el MISMO registro
(`_shared/herramientas.ts`) y el MISMO `toolsParaUsuario(cap, modulos)`, filtrado
además por canal (`canales: ['compa','mcp']`). Diferencias de comportamiento
frente a Compa:

| Qué | Compa | MCP |
|---|---|---|
| `generar_reporte_pdf`, `recordar` | ✔ | ✘ (canales:['compa'] — B1) |
| `buscar_usuarios` | id+nombre+**email** | id+nombre (**email recortado** — uso interno vs. tercero) |
| `proponer_*` | borrador + confirmar en el chat | borrador (`claude_borrador_crear`) + confirmar en `/borrador/:id` — **nunca ejecuta** |
| `reportar_gap` | matching contra tools disponibles (CP3/CP9) | registra directo (`registrar_consulta_no_atendida`), sin el matching fino de Compa |
| Auditoría | `assistant_acciones` | `sgc.claude_llamadas` (sin el resultado completo, solo resumen) |
| Gate previo a cualquier tool | consentimiento IA + rate limit propio | **además**: `claude_conector_activo` (503 si apagado), `claude_conector_max_hora` (429) |
| RPC de alto riesgo (roles, permisos extra, fusión de usuarios, claves) | nunca expuestas como tool | nunca expuestas como tool, **y además** la RPC misma rechaza el token (`client_id` presente) si alguien la llamara por otra vía — ver `docs/CLAUDE-CONECTOR.md` §7 |

No hay tool de SQL libre ni de lectura de archivos sin tool detrás — el
servidor `mcp` solo ofrece lo que está en el registro, igual que Compa.
