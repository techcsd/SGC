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
| desempeno_semana | desempeno_semana→incentivo_listado | puede_gestionar_incentivos (admin/módulo incentivos) | ✔ | oculto | oculto | ✔ (AY6) | oculto |
| cronograma_de_obra | listar_cronograma | puede_ver_cronograma(obra) (raise 42501) | ✔ | su obra (pend AY4) | oculto | oculto | oculto |
| personal_de_obra | personal_obra_conteos | puede_ver_personal_obra(obra) ({} si no) | ✔ | su obra (pend AY4) | oculto | oculto | oculto |

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

## Vetos (§5) — NO existen ni se construyen
Tools de credenciales/API keys/configuración del sistema · escritura de permisos por
chat · ejecución de escritura sin confirmación · datos en archivos sin tool detrás.
