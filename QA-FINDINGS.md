# QA-FINDINGS — SGC Web (Actualización 5)

_QA total del sistema. BD = PRODUCCIÓN. Discovery = auditoría estática + BD read-only (SELECTs) cruzando reglas de negocio de CONTEXTO 1–4. **No se creó ningún dato QA-TEST** (discovery read-only), por lo que no hay limpieza de datos pendiente. Correcciones aplicadas en código + 4 migraciones SQL aditivas._

_Actualizado: 2026-07-16 · Estado: **FASE 3 completa** · `npm run build` OK (exit 0) · sin commit/push (pendiente aprobación)._

## Resumen ejecutivo por severidad
| Sev | Encontrados | Resueltos | Propuesta (decisión producto) | Menores pendientes |
|-----|-------------|-----------|-------------------------------|--------------------|
| Crítico | 0 | 0 | 0 | 0 |
| Alto | 9 | 9 | 0 | 0 |
| Medio | ~24 | 22 | 1 (QA-032) | 0 |
| Bajo | ~16 | 14 | 0 | 2 (QA-041, QA-057=dato) |
| Mejora/propuesta | ~14 | — | ~14 (QA-070…080) | — |

**Núcleo verificado OK** (sin hallazgos): gating por rol, versionado semver/publicar/notificar admin-only, subida APK, auditoría drill-down, otros_valores→avisos, homologación, 8 categorías oficiales, tallas EPP, resumen salida/entrada, conteo "todo conforme", pool vehículos + reporte semanal, km coherente + fotos combustible, bloqueos pre-uso, mantenimiento por km + crear cita, rutas, W4 (comentarios aprobador/revisor visibles), interconexiones principales, sin stock negativo, sin usuarios sin rol, sin overloads RPC ambiguos.

---

## ALTO — 9/9 resueltos
| ID | Módulo | Fix | Estado |
|----|--------|-----|--------|
| QA-001 | Flota | RPC combustible rechaza vehículo no_disponible/baja + pickers de combustible/rutas los excluyen | ✅ Resuelto |
| QA-002 | Inventario | Salida/Entrada excluyen artículos desactivados del selector | ✅ Resuelto |
| QA-003 | Proyectos | Montos `$`→`RD$` (4 lugares) | ✅ Resuelto |
| QA-004 | RRHH | Drawer de detalle read-only del empleado (todos los campos) | ✅ Resuelto |
| QA-005 | Compras | KPI de gasto incluye `recibida_parcial` | ✅ Resuelto |
| QA-006 | Documentos | Campos fecha → fecha larga es-DO en el documento | ✅ Resuelto |
| QA-007 | Mensajes | Autor del historial de grupo resuelto vía `nombrePorId` | ✅ Resuelto |
| QA-008 | Tecnología | `updateEquipo` registra historial (estado/asignación/edición) | ✅ Resuelto |
| QA-009 | Inventario | Columna Talla en el conduce/PDF | ✅ Resuelto |

## MEDIO — resueltos (excepto QA-032 propuesta)
QA-010 recepción ≤ enviado (RPC + UI) ✅ · QA-011 alerta pago>trabajado ya visible en detalle ✅ · QA-012 columna Solicitante + empty-state neutral ✅ · QA-013 estados A2 (despacho/compra) visibles ✅ · QA-014 label de fase ✅ · QA-015/016 TZ off-by-one legal (ISO compare) ✅ · QA-017 TZ off-by-one tareas/tec/mensajes ✅ · QA-018 moneda unificada RD$ ✅ · QA-019 badge/label `recibida_parcial` ✅ · QA-020 proyecto en OC ✅ · QA-021 dirección de proveedor ✅ · QA-022 borrar plantilla: confirm + protege sistema ✅ · QA-023 nombre doc + metadatos ✅ · QA-024 KPI auditoría relabel "Áreas" + terminología unificada ✅ · QA-025 TABLA_LABELS + 2 keys muertas ✅ · QA-026 conductor visible en combustible ✅ · QA-027 fechas humanas en avisos ✅ · QA-028 talla al ítem de compra ✅ · QA-029 conductor/vehículo en entregas ✅ · QA-030 notify con try/catch ✅ · QA-031 toasts en fallos de estado (compras/legal/rrhh/mensajes) ✅ · QA-033 limpiar composer al cambiar conversación ✅ · QA-034 separadores por día en el hilo ✅ · QA-035 empty-state dashboard bitácora ✅
- **QA-032** RRHH: ausencia aprobada → registros de asistencia — **Propuesta** (regla de negocio; no implementado).

## BAJO — resueltos (menores pendientes anotados)
QA-040 label estado solicitud-compra ✅ · QA-042 "atendido por" (degradado si no hay join) ✅ · QA-043 accidente exige lesionados>0 ✅ · QA-044 checklist valida km coherente ✅ · QA-045 autosugerencia conductor legacy — documentado (sin over-engineering) · QA-046 fecha humana en conflicto de mantenimiento ✅ · QA-047 teléfonos con máscara (proveedores/rrhh) ✅ · QA-048 validación RNC/cédula ✅ · QA-049 asistencia cuenta "Feriado" ✅ · QA-050 label tipo_cambio historial TI ✅ · QA-051 fallback (error) en fotos TI ✅ · QA-052 cantidad vacía en compras-TI manejada ✅ · QA-053 numeros con separador en documentos ✅ · QA-054 empty-states documentos ✅ · QA-055 comentarios de tarea en realtime ✅ · QA-056 montos RD$ en entradas ✅ · QA-058 marcar leído solo con pestaña visible ✅
- **QA-041** solicitudes-compra: fila expandible con renglones (proveedor sugerido, ver foto, notas, categoría, enlace a OC/origen) — ✅ Resuelto.
- **QA-057** categorías destacada solo en inactivas — **es dato, no código** (marcar una categoría activa como destacada si se desea).

## MEJORA / PROPUESTA (decisión de producto — NO implementadas)
QA-070 crear/enlazar equipo TI desde compra aprobada · QA-071 inventario TI costo/garantía/fecha compra · QA-072 asignación TI reflejada en ficha de empleado · QA-073 editar/reasignar tarea creada · QA-075 enlace externo en expediente legal · QA-076 recepción OC reconciliada por ítem con entradas · QA-077 export .docx real · QA-078 KPI ausencias pendientes en dashboard · QA-079 comentario revisor en columna propia + reabrir resueltas · QA-080 catálogo de puestos en matriz TI · + menores WCAG/UX (labels, auto-scroll, búsqueda por participante).

---

## Migraciones SQL aplicadas (aditivas/retrocompatibles, prod)
- `sql/2026-07-16-qa5-fixes-db.sql` — QA-001 (combustible estado), QA-010 (recepción ≤ enviado), QA-028 (talla al faltante), QA-074 (RLS `tareas: update` WITH CHECK).

## FASE E2E — Playwright (navegador real contra prod desplegado)
Harness: `playwright.config.ts` + `qa/e2e/*` (devDependency `@playwright/test`, NO en build de prod). Credenciales en archivo gitignoreado (borrado tras la pasada).
**Resultado: 9/9 roles PASS.** Por cada rol: login por UI ✅, **gating correcto** (accede a sus módulos; los ajenos → /403; **sin fugas**), rutas abiertas accesibles, y captura de errores de consola / llamadas fallidas / screenshots como evidencia (reporte en `qa/report/`). El test falla solo ante fugas de gating — no hubo ninguna. Roles probados: admin, jefe_flota, guarda_almacen, ingeniero_campo, gerente_proyectos, coord_compras, jefe_rrhh, abogado, nomodulos.

## Datos QA-TEST creados / limpiados
| Tipo | Identificador | Creado | Limpiado |
|------|---------------|--------|----------|
| Usuario auth+perfil+rol | qa.test+admin@constructorasd.com | ✅ | ✅ eliminado |
| Usuario | qa.test+jefe_flota@ · +guarda_almacen@ · +ingeniero_campo@ · +gerente_proyectos@ | ✅ | ✅ eliminados |
| Usuario | qa.test+coord_compras@ · +jefe_rrhh@ · +abogado@ · +nomodulos@ | ✅ | ✅ eliminados |
| **Verificación** | `select count(*) … qa.test+%` = **0** | — | ✅ sin residuos |

_Discovery (FASE 1) fue read-only (0 datos). Los únicos datos QA-TEST creados fueron los 9 usuarios de la pasada E2E, todos eliminados. La pasada E2E fue solo-navegación (no creó vehículos/almacenes/bitácoras)._
