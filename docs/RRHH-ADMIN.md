# RRHH + Administración de la empresa — diseño (DN-26, ronda DN, 11-nov-2026)

Nota N10 de Xaviel: *"the RRHH module need to be improved and add more submodules... that module gonna handle the administration of the company too (because rrhh do that too)."* Respuestas a las preguntas de seguimiento:
- Submódulos de Personas: **Contratos y documentos, Nómina y pagos, Reclutamiento y onboarding, Evaluaciones/capacitación/organigrama**, + "cualquier otro coherente".
- Administración: **Gastos y caja chica, Proveedores y contratos, Activos y oficina, Trámites y cumplimiento**.
- Privacidad: **"Solo RRHH + Gerencia, con auditoría"**.

## 1. Inventario del módulo actual (código real, 11-nov-2026)

4 pantallas en `/rrhh`, menú `shell.ts:219-227`, rutas `src/app/pages/rrhh/rrhh.routes.ts`:

| Ruta | Submódulo | Guard | Notas |
|---|---|---|---|
| `/rrhh/empleados` | `rrhh.empleados` | `submoduloGuard` ✓ | CRUD completo, asignaciones (equipos TI), **ya sube documentos** (`empleado_documentos`, tipo libre, sin vigencia/vencimiento) |
| `/rrhh/asistencia` | `rrhh.asistencia` | `submoduloGuard` ✓ | marcaje diario |
| `/rrhh/ausencias` | `rrhh.ausencias` | `submoduloGuard` ✓ | permisos/vacaciones |
| `/rrhh/reportes` | *(ninguno)* | **✗ sin guard** | DN14 — hueco real, se corrige en esta ronda |

Modelo de datos ya existente y **reutilizable** (`src/shared/models/empleado.model.ts`, tabla `sgc.empleados`):
`cedula, nombre, apellido, cargo, departamento, fecha_ingreso, salario, tipo_contrato, jefe_id` (ya existe — **el organigrama ya tiene su dato base**), `fecha_egreso, motivo_egreso, numero_tss, afp, ars, dias_vacaciones_anuales, banco, cuenta_banco`.

`sgc.empleado_documentos` (ya existe): `empleado_id, tipo (texto libre), nombre, archivo_path, tipo_mime, subido_por`. **Sin** `vigencia_hasta` ni alerta — el hueco real de "Contratos y documentos" (P1).

Permisos: `SUBMODULOS.rrhh` en `roles.service.ts:154-160` (3 claves, `enforced: true`). `MODULOS_DISPONIBLES` describe `rrhh` como "Empleados, asistencia, ausencias/vacaciones y documentos de personal" (DN-29 la actualiza).

**Administración de la empresa no tiene casa** (DN15): ya existen piezas sueltas bajo `compras` —
- `sgc.gastos_directos`/`gasto_categorias` (`sql/2026-08-17-as14-as23-compras-gastos-zona.sql`, `2026-11-02-df-gastos-ui.sql`) + pantalla `/compras/gastos` (`src/app/pages/compras/gastos/`). **DN-29 reusa esto tal cual** (enlace, no duplicado).
- Proveedores (`sgc.proveedores`, módulo `compras.proveedores`) — existe para proveedores de **material/transporte**; `rrhh.proveedores` (administrativos: internet, limpieza, seguros) es un concepto distinto, tabla nueva.
- Nada de activos de oficina ni trámites/permisos/licencias de la empresa.

### 1.1 Hallazgo de seguridad (DN-28 — reportado, no cambiado a ciegas)

`sgc.nivel_submodulo(p_key)` (`sql/2026-08-05-ag12-permisos-granulares.sql:20-40`), la función detrás de `puede_ver_submodulo`/`puede_operar_submodulo` que usa **todo** el sistema de permisos granulares, tiene **dos bypasses**:
```sql
when sgc.is_admin() then 'operar'
when sgc.tiene_modulo(split_part(p_key,'.',1)) then 'operar'  -- compat: módulo padre completo
```
Si los submódulos sensibles de RRHH (`rrhh.nomina`, `rrhh.evaluaciones`, `rrhh.disciplina`, expedientes) se gatean con el patrón estándar (`puede_ver_submodulo`/`puede_operar_submodulo`), **cualquier admin (incluida Tecnología) y cualquier rol con el módulo `rrhh` completo en `roles.modulos` vería nómina/disciplina** — viola "Solo RRHH + Gerencia" explícitamente.

**Decisión de esta ronda (reportado a Xaviel, no es un cambio silencioso):** los submódulos sensibles **NO** usan `nivel_submodulo`. Usan una función nueva, paralela, **sin bypass de admin ni de módulo padre**:
```sql
create or replace function sgc.puede_rrhh_sensible(p_key text)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and coalesce(r.permisos->>p_key,'') in ('ver','operar')
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('rrhh','gerencia','direccion')
  );
$$;
```
Nota: se deja `codigo in ('rrhh','gerencia','direccion')` como fallback por si todavía no existe un rol específico "RRHH" con permisos granulares asignados — **Xaviel decide** si ese fallback por código de rol se queda o se reemplaza 100% por permisos granulares una vez cree el rol RRHH real. Reportado explícitamente, no decidido en automático.

Toda lectura de un submódulo sensible (ver un salario, una evaluación, un expediente) se registra en `sgc.rrhh_accesos_log` (quién, qué, cuándo) — ver §3.

## 2. Menú propuesto — dos secciones

```
RRHH
├─ Personas
│   ├─ Empleados            (ya existe)
│   ├─ Contratos y documentos   [P1 — nuevo, rrhh.contratos]
│   ├─ Organigrama           [P1 — nuevo, rrhh.organigrama, usa jefe_id/cargo ya existentes]
│   ├─ Reclutamiento (onboarding) [P1 — SQL listo en dev, UI pendiente]
│   ├─ Asistencia            (ya existe)
│   ├─ Ausencias / Vacaciones (ya existe)
│   ├─ Nómina y pagos        [P2 — SQL listo en dev, UI pendiente]
│   ├─ Evaluaciones          [P2 — SQL listo en dev, UI pendiente]
│   ├─ Capacitación          [P2 — SQL listo en dev, UI pendiente]
│   └─ (P3, propuestos: Disciplina · Beneficios · Dotación · Comunicados · Tablero)
└─ Administración
    ├─ Gastos y caja chica   (enlaza a /compras/gastos — NO duplicado)
    ├─ Trámites y cumplimiento [nuevo, rrhh.tramites — prioridad 2 de Administración]
    ├─ Proveedores (admin.)  [nuevo, rrhh.proveedores — prioridad 3]
    ├─ Activos y oficina     [nuevo, rrhh.activos — prioridad 4]
    └─ Reportes              (ya existe — DN14 le agrega submoduloGuard)
```

## 3. Privacidad — tabla de auditoría

```sql
create table if not exists sgc.rrhh_accesos_log (
  id serial primary key,
  usuario_id uuid references sgc.usuarios(id),
  submodulo text not null,      -- 'rrhh.nomina', 'rrhh.evaluaciones', etc.
  accion text not null,         -- 'ver_lista' | 'ver_detalle' | 'exportar'
  empleado_id uuid references sgc.empleados(id),  -- null si fue una lista, no un detalle
  creado_en timestamptz not null default now()
);
-- insert-only desde las RPC sensibles (RLS: nadie actualiza/borra, ni admin).
```

## 4. Nómina — alcance honesto

**Cálculo asistido + exportación, NUNCA mueve dinero.** Fórmulas TSS/AFP/SFS/ISR parametrizables en una tabla `sgc.rrhh_nomina_parametros` (porcentajes, topes), marcadas explícitamente `-- validar con contador antes de usar en producción`. La pantalla genera un PDF/Excel del período; no hay integración bancaria ni de pago.

## 5. Orden de entrega de esta ronda (DN-33) — estado real al cierre

F0/F0b → higiene/al-día → módulo Claude (DN-22/23) → Cargos (DN-24) → c1102070 (DN-25) → este documento → privacidad (función + auditoría) → P1 → Administración → P2.

| Submódulo | SQL+RLS en dev | UI | Notas |
|---|---|---|---|
| `rrhh.contratos` | ✓ | ✓ | P1, sensible, con auditoría de lectura |
| `rrhh.organigrama` | ✓ | ✓ | P1, usa `jefe_id`/`cargo` ya existentes |
| `rrhh.onboarding` | ✓ | ✓ | P1 completo — vacantes + pipeline de candidatos |
| `rrhh.gastos` | *(reusa compras)* | ✓ | Administración prioridad 1 — enlace, no duplicado |
| `rrhh.tramites` | ✓ | ✓ | Administración prioridad 2 |
| `rrhh.proveedores` | ✓ | ✓ | Administración prioridad 3 |
| `rrhh.activos` | ✓ | ✓ | Administración prioridad 4 |
| `rrhh.nomina` | ✓ | ✗ | P2, sensible — solo tablas/parámetros, sin motor de cálculo ni pantalla |
| `rrhh.evaluaciones` | ✓ | ✗ | P2, sensible |
| `rrhh.capacitacion` | ✓ | ✗ | P2 |
| `rrhh.disciplina`, `rrhh.beneficios`, `rrhh.dotacion`, `rrhh.comunicados`, `rrhh.tablero` | ✗ | ✗ | P3 — solo diseño (ver §0, nota N10); sin SQL esta ronda, el tiempo no alcanzó |

Todos los submódulos de la tabla (construidos o no) ya están en `SUBMODULOS.rrhh` (`roles.service.ts`) — el editor de permisos de Administración ya los puede asignar a roles, listos para cuando se construya la pantalla que falta.

## 6. Paridad app móvil (DN-31)

Esta ronda es **web-only**. La app no gana RRHH/Administración nuevos. Paridad solo donde ya exista pantalla equivalente (Ausencias/Asistencia). "Mis documentos y recibos" para el empleado en la app queda **diseñado, no construido** (P3), pendiente de consentimiento explícito antes de mostrar nómina/expediente en el teléfono.
