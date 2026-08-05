# AG13 — Módulo Administración: inventario, criterio y consolidación

## Estado actual (verificado en repo)
El módulo **Administración** (`modulo: admin`, ruta `/admin`, guard `moduleGuard('admin')`) YA existe y NO está vacío. Contiene:

| Submódulo | Ruta | Qué hace |
|---|---|---|
| Usuarios | `/admin/usuarios` | Alta/baja, roles asignados, activación, reset de PIN/password |
| Roles y permisos | `/admin/roles` | Roles + módulos + **matriz de permisos por submódulo (AG12, nuevo)** |
| Unidades | `/admin/unidades` | Unidades de medida del inventario |
| Catálogos de bitácora | `/admin/bitacora-catalogos` | Catálogos editables de la bitácora |
| Parámetros | `/admin/parametros` | Umbrales de cuadre/antifraude |
| Valores "Otro" | `/admin/otros-valores` | Normalización de "Otro" estructurado |
| **Notificaciones** | `/admin/notificaciones` | **AG14 (nuevo)** — qué eventos avisan al admin y por qué canal |
| Auditoría | `/admin/auditoria` | Log de auditoría (web + app), analítica + drill-down + export |
| Comentarios y Reportes | `/admin/reportes` | Bandeja de tickets/soporte del admin |

## Criterio Administración vs Tecnología (Y11)
- **Administración (negocio / usuarios):** todo lo que gestiona el *negocio* y las *personas* — usuarios, roles/permisos, catálogos operativos, parámetros de negocio, auditoría de acciones, tickets de soporte, configuración de notificaciones. Acceso: rol/módulo `admin`.
- **Tecnología (técnico / infraestructura):** todo lo *técnico de plataforma* — versiones de la app (rollout), historial de versiones, reportes de errores/crash (Y6), monitoreo de dominios/infra, QA (casos/corridas). Acceso: `es_tecnologia()` (admin/tecnologia/gerencia/direccion). Por eso "Versiones de la app" e "Historial de versiones" se **movieron** de Administración a Tecnología (con redirects para no romper enlaces).

Regla práctica: *si lo cambia un gerente/administrador del negocio → Administración; si lo revisa quien mantiene el sistema → Tecnología.*

## Cambios de esta ronda (AG13)
- **+ Submódulo "Notificaciones"** (AG14): configura eventos/canales de aviso al admin. Ruta `/admin/notificaciones`, en el menú de Administración.
- **Roles** ahora expone la **matriz de permisos por submódulo** (AG12): otorgar un submódulo específico (ej. Compras → solo Proveedores → Ver) sin dar el módulo completo.

## Pendiente / follow-up (documentado, no bloquea)
- **Empresa / parámetros generales**: hoy `/admin/parametros` son umbrales de cuadre, NO datos de empresa (razón social, RNC, logo, direcciones). Falta una página "Empresa" dedicada — candidato para la próxima ronda.
- **Orden de módulos (AF38)**: no existe UI para reordenar el menú; el orden es el arreglo de `shell.ts`. Follow-up: tabla `modulo_orden` + drag-reorder en Administración.
- **Enforcement granular por submódulo (AG12)**: hoy gateado end-to-end para `compras.proveedores` (menú + ruta + RLS). Los demás submódulos del catálogo se guardan y se irán gateando; el checkbox del módulo padre sigue siendo el control principal.
