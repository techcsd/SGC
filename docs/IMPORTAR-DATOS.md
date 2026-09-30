# Importar datos (BT1) — TotalEnergies, Odoo y otros

Dos vías de importación, para dejar de vivir en varios sistemas.

## 1. Echadas de combustible desde la factura de TotalEnergies

**Dónde:** Flota › Conciliación de combustible.

1. Sube el PDF/Excel de la factura de TotalEnergies (ya existía).
2. El sistema **concilia** las filas de la factura contra las echadas registradas
   (tolerancias en `flota_config`). Las que **no cuadran con ninguna** aparecen en la
   pestaña **«Solo informe»** — son echadas que alguien no registró.
3. Pulsa **«Registrar N echada(s) faltante(s)»**. El sistema:
   - guarda la conciliación (traza fiscal, con el PDF),
   - crea una echada por cada fila sin match (`registros_combustible.importada = true`,
     `conciliacion_id`, `origen = 'estacion'`),
   - resuelve el **vehículo** por la tarjeta (`combustible_tarjeta_map`) y el **conductor**
     por la asignación/uso de esa fecha; si no se resuelve, queda `sin_asignación` para que
     Raykler lo complete,
   - si la factura **no trae kilometraje**, marca `km_pendiente` (no dispara salto de km) y
     avisa a Flota para completarlo.
   - Es **idempotente**: reimportar la misma factura no duplica.
4. Las echadas importadas se ven en **Flota › Registro de combustible** con el chip
   **IMPORTADA** (y **KM PENDIENTE** si falta el kilometraje).

**Tarjeta → vehículo:** en Conciliación, cada tarjeta sin vehículo tiene un selector
«asignar vehículo» que **recuerda** la relación (`combustible_tarjeta_map`) para la próxima.
Raykler la llena una vez.

## 2. Importador genérico «Importar datos» (Odoo y otros)

**Dónde:** Administración › **Importar datos** (`/admin/importar`).
Gate por entidad: proveedores/vehículos = admin o flota elevado; artículos = módulo
Inventario.

Asistente en 4 pasos: **entidad → archivo (.xlsx/.csv) → mapeo de columnas → preview →
importar**. El mapeo se **recuerda por entidad** (`importaciones_mapeo`). Cada importación
queda en `importaciones` y se puede **deshacer en 24 h** (borra solo las filas que creó; las
actualizadas quedan). Descarga una **plantilla** por entidad con los encabezados + ejemplos.

### Qué exportar de Odoo (Lista › ⚙ Acción › Exportar)

El auto-mapeo reconoce los nombres de columna de los exports estándar de Odoo:

| Entidad SGC | Modelo Odoo | Columnas que reconoce |
|---|---|---|
| Proveedores | `res.partner` | `name`, `vat`, `phone`, `email`, `street` |
| Vehículos | `fleet.vehicle` | `license_plate`, `brand`/`model_id`, `model`, `color` |
| Artículos | `product.template` | `name`, `default_code`, `categ_id`, `uom_id` |

En Odoo: abre la vista de lista, selecciona las filas (o todas), **Acción → Exportar**,
elige los campos de la tabla y descarga en **Excel (.xlsx)**. Súbelo tal cual en
`/admin/importar`; el asistente mapea las columnas automáticamente (puedes ajustarlas antes
de importar).

### Notas
- Los artículos importados nacen sin stock; el stock inicial se carga por **Apertura de
  inventario** (flujo existente). *(v1: el importador crea el artículo + su categoría; el
  stock por almacén queda para una tanda siguiente.)*
- Entidades v1 del importador genérico: **proveedores, vehículos, artículos**. Conductores,
  personal y proyectos/obras se añaden en tandas siguientes (personal y proveedores ya tienen
  su propio importador; ver AT5/BO3).

## 3. Importar desde Odoo en su módulo (CC4 — #87)

El asistente de importación (`shared/components/importar-odoo`) ahora vive también **dentro de cada módulo**, con la entidad preseleccionada, para que no sea solo de Tecnología:

- **Compras › Proveedores → "Importar desde Odoo"** (`/compras/proveedores/importar`, gate = proveedoresGuard). Para Raykler.
- **Flota › Vehículos → "Importar desde Odoo"** (`/flota/vehiculos/importar`, gate = flota-elevado).
- **Inventario › Artículos → "Importar desde Odoo"** (`/inventario/articulos/importar`, gate = módulo inventario).
- `/admin/importar` (Tecnología) sigue igual: elige entre las tres entidades.

### El archivo tal como sale de Odoo
El asistente reconoce los encabezados de un export de Odoo **en español, inglés y técnicos** (Odoo 16/17) y transforma los datos:

- **ID externo** (`ID` / `External ID`, `__export__.res_partner_123`) → `odoo_ref`. Es la **clave de idempotencia**: reimportar **actualiza** en vez de duplicar (los 3 RPC `importar_*` emparejan por `odoo_ref` primero y lo guardan).
- **RNC/cédula** (`vat` / NIF-RNC) → solo dígitos, valida 9 (RNC) u 11 (cédula).
- **Teléfono** → formato RD.
- **Relacional** (`categ_id` "Todos / Materiales / Acero") → última hoja ("Acero").
- **Unidad de medida** ("Unidades", "Litro(s)", "kg"…) → unidad SGC por tabla de equivalencias.
- **Booleanos** (`is_company`/"Es una compañía", `active`/"Activo").
- **Filas de continuación** (ID/clave vacíos en exports con líneas hijas) → se funden con la fila anterior.
- `.xlsx` y `.csv` (coma o punto y coma, UTF-8 o Latin-1).

La vista previa muestra cada transformación ("categ 'Todos / Materiales / Acero' → Acero"). Deshacer 24 h intacto.

### Plantilla / cómo exportar
El botón dejó de ser una plantilla nuestra: ahora hay **"Cómo exportar desde Odoo"** (pasos en *Acción → Exportar*, marcando "Exportar como ID") + un **ejemplo con los encabezados reales de Odoo**; la **"Plantilla SGC (sin Odoo)"** queda como opción secundaria.

Fixtures de prueba (encabezados reales ES/EN) en `qa/fixtures/odoo/`; spec en `src/shared/services/importador-odoo.service.spec.ts`.
