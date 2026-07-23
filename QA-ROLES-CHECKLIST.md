# QA por rol — Alcance de datos y permisos (R14)

> Cierra el último punto abierto de R14 en el INFORME-VERIFICACION: el enforcement
> (RLS scoping de flota + guards por submódulo + UI de sidebar/hub + dashboard
> segmentado) **ya está implementado y verificado**; faltaba el **seed de usuarios
> de prueba por rol + esta checklist** para ejecutarlo sistemáticamente.
>
> **Cómo obtener los usuarios de prueba:** correr `node scripts/seed-usuarios-prueba.mjs`
> (requiere `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` en el entorno). Crea
> `qa-<codigo>@prueba.constructorasd.local` por cada rol con una contraseña QA
> compartida. Limpiar al terminar: `node scripts/seed-usuarios-prueba.mjs --purge`.
>
> Ejecutar la checklist **en web y en la app** con cada usuario. El foco principal
> es Flota (donde vivía el problema de "el chofer ve todo").

## Matriz rol × acceso esperado

| Rol (codigo) | Módulos | Debe VER | NO debe ver |
|---|---|---|---|
| `admin` | todos | Todo, incl. Administración, datos de prueba (con toggle), Auditoría | — |
| `direccion` | direccion, (lectura amplia) | Vista ejecutiva/KPIs consolidados, Flota global (elevado) | Administración (usuarios/roles) |
| `gerencia` | según config | Dashboards de su alcance, Flota global (elevado) | Administración |
| `gerente_proyectos` | proyectos, bitacora… | Proyectos, ranking, bitácora | Flota reportes globales si no es elevado |
| `ingeniero_oficina` | proyectos, bitacora, documentos | Sus obras, bitácora, documentos | Administración, Flota admin |
| `ingeniero_campo` | bitacora, proyectos | Bitácora del día, sus obras | Administración, Flota admin |
| `jefe_flota` | flota (elevado) | **TODA** la flota: Reportes, Panel del día, Rutas, Conductores, Combustible, Avisos, Responsabilidad | Administración |
| `chofer_transportista` | flota (NO elevado) | **SOLO lo suyo**: Mi actividad, Mis checklists/pre-usos, Mis rutas/conduces, Combustible que él registró, Reporte semanal de SUS vehículos, Avisos relacionados a él | **NO**: Reportes, Panel del día global, Responsabilidad de otros, lista completa de Conductores, crear rutas |
| `coord_compras` | compras, inventario | Solicitudes/OC, inventario | Flota admin, Administración |
| `logistica` | inventario, compras | Inventario, movimientos, conduces | Administración, Flota admin |
| `guarda_almacen` | inventario | Su almacén, entradas/salidas, conteos | Reportes ejecutivos, Administración |
| `jefe_rrhh` | rrhh | Empleados, asistencia, ausencias, docs de personal | Flota admin, Administración |
| `abogado` | legal | Expedientes, contratos, aprobaciones | Flota admin, RRHH, Administración |
| `encargado_tecnologia` | tecnologia (+admin según config) | Inventario tecnológico, matriz TI | Datos operativos ajenos |

`es_flota_elevado()` = admin / direccion / gerencia / jefe_flota. Todo lo demás con módulo `flota` es **no elevado** (alcance "solo lo mío").

## Checklist por sesión (repetir por rol, en web y app)

Para CADA usuario de prueba:

**A. Gating de navegación (sidebar / hub)**
- [ ] El sidebar (web) muestra **solo** los módulos del rol; nada más.
- [ ] El hub de Transporte (app) muestra **solo** los cuadros permitidos (el chofer NO ve "Crear ruta", "Reportes", "Panel del día", "Responsabilidad").
- [ ] Intentar navegar por URL directa a una ruta no permitida → redirige/bloquea (guard).

**B. Alcance de datos en Flota (el foco de R14)** — con `chofer_transportista`:
- [ ] **Rutas / Conduces**: ve solo las asignadas a él (no las de otros conductores).
- [ ] **Combustible**: el listado/historial muestra solo sus echadas.
- [ ] **Checklists / Pre-usos**: solo los suyos.
- [ ] **Reporte semanal**: vista de chofer (solo SUS vehículos + CTA a llenar); **no** el dashboard global de faltantes ni KPIs de toda la flota (T7).
- [ ] **Avisos de flota**: solo los relacionados a él/sus registros (filtro "Míos").
- [ ] **Entregas/recepciones**: solo las suyas.
- [ ] Confirmar en red (DevTools) que las respuestas RLS **no** traen filas ajenas (no basta con ocultarlas en UI).

**C. Alcance de datos con `jefe_flota` (elevado)**
- [ ] Ve **toda** la flota en todos los submódulos (contraste con el chofer).
- [ ] `generarAvisos()` corre para él (no para el chofer).

**D. Datos de prueba (T2)**
- [ ] Con un no-admin: los registros `es_prueba=true` **no** aparecen en listados ni dashboards.
- [ ] Con `admin`: aparece el toggle "mostrar datos de prueba" + badge "PRUEBA".
- [ ] Los agregados (dashboard de combustible, promedios de consumo) **no** cuentan datos de prueba (verificado también server-side tras `2026-07-23-verif-esprueba-consumo.sql`).

**E. Otros módulos (barrido rápido)**
- [ ] Cada rol no-admin: confirmar que Inventario / Compras / RRHH / Legal / Proyectos / Bitácora solo exponen lo de su alcance; ninguna pantalla filtra data ajena a usuarios no elevados.

## Resultado
Registrar por rol: ✅ pasa / ⚠ fuga detectada (con captura + endpoint). Cualquier fuga
es un bug de RLS o de guard — abrir tarea y corregir servidor primero.
