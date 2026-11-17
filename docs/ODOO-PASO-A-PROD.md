# Runbook: pasar la integración SGC ↔ Odoo a producción (EJECUTADO EN CANARY, 17-nov-2026)

Estado (17-nov-2026): **ejecutado en prod y contra el Odoo real, en modo canary.** Migraciones DS/Odoo aplicadas por ledger (excepto los lotes RLS `ds46` y `dj1-dj3`, sin aplicar por decisión), 9 edges, secrets, homologación (`scripts/data-fixes/2026-11-16-ds-homologacion-prod.mjs`), 16 ubicaciones de cuarentena creadas con la cuenta Tecnología CSD (`...-ds-cuarentena-prod.mjs`) y canary encendido (`...-ds-encender-prod.mjs`, con `--apagar` para revertir). Canary validado con A+B reales (17-nov); **expansión encendida** (`...-ds-expansion-prod.mjs`, `--apagar` la revierte) y `ODOO_ESCRITURA_HABILITADA=true` (OC reales). Front 1.218.0 en main. Catálogo: 51 de 305 artículos vinculados (29 por nombre exacto, `...-ds-catalogo-exacto-prod.mjs`); ~179 no tienen producto en Odoo. Catálogo completo vinculado (230/230, 179 productos creados en Odoo). **Corte de Bodega Central ejecutado (17-nov, opción A: Odoo manda)**: respaldo del stock SGC en `odoo_corte_respaldo_stock`, sin apertura escrita en Odoo, `fuente_odoo` encendida y SGC alineado a Odoo (0 diferencias en 223 artículos); conduce de prueba y su reversa OK. Revertir: `...-ds-corte-central-prod.mjs --paso apagar`. **Las 15 bodegas restantes también cortadas (17-nov, `...-ds-corte-resto-prod.mjs`; revertir con `--apagar`): 16/16 con Odoo como fuente, 3136 filas de stock con 0 diferencias frente a Odoo.** La contracción (DS-30) NO se aplicó: `odoo_comandos_oc` sigue siendo la tabla de idempotencia de las OC reales (`odoo-api`), así que retirarla rompería la creación de OC; las condiciones del script solo miran que esté vacía. Se aplicó la parte B (`sql/2026-11-17-ds30b-contraccion-vinculos-stock.sql`, dev y prod): retira solo `odoo_vinculos_stock*` (sin uso); `odoo_comandos_oc` se conserva. Maestros (`articulo`) no se publican (sin política, por diseño). Cada paso siguiente necesita OK nombrado de Xaviel. Repo público: sin hosts, usuarios, claves, UUID ni refs; los valores van en secrets/variables, nunca aquí. Todo lo que se escribe en prod vive versionado en `sql/` o `scripts/data-fixes/` y en el ledger (regla 19 / CD10).

Evidencia previa: [`docs/avance-lotes/W3-e2e.md`](./avance-lotes/W3-e2e.md) (E2E real en dev contra staging) y [`docs/ODOO-RUNBOOK-REVERSA.md`](./ODOO-RUNBOOK-REVERSA.md).

## 0. Precondiciones (todas deben ser ciertas antes del paso 1)
1. `node scripts/odoo-e2e-dev-staging.ts` (ver W3-e2e) pasa en dev contra staging, y `node scripts/release-check.mjs --env dev --version X.Y.Z` pasa (regla CP5) con el registro humano `qa/release-<versión>.md`.
2. La cuenta de integración del Odoo real existe y tiene **los mismos permisos que en staging** (ver §6) — verificar con una lectura, no con una escritura.
3. Contabilidad confirmó las cuentas analíticas de los proyectos (§5) y Operaciones confirmó las obras con cuentas dudosas.
4. Un admin ratificó las decisiones ADR 4, 5, 10, 11 y 15 en la pantalla (la ratificación de dev **no** vale para prod).
5. Hay una ventana acordada con Inventario y un responsable que mira Tecnología › Sincronización con Odoo durante la primera semana.

## 1. Migraciones (orden por ledger de dev, regla 18)
Aplicar **solo** lo que el ledger de dev tiene y prod no. `scripts/apply-migration.mjs --env prod` rechaza lo que no esté en el ledger de dev con el mismo checksum. Orden exacto = orden de `aplicada_en` en el ledger de dev (consulta de solo lectura):

```
select archivo from sgc.migraciones_aplicadas where aplicada_en >= '2026-11-16' order by aplicada_en;   -- en DEV
```

Por cada archivo, en ese orden: `node scripts/apply-migration.mjs sql/<archivo>.sql --env dev --dry-run` (ya está) → **prod** `node scripts/apply-migration.mjs sql/<archivo>.sql --env prod` (con el OK de Xaviel).

Hitos que importan para encender (los demás de la lista son del resto de la ronda DS y van igual por orden):
- Esquema base de salidas/entradas/vínculos: `ds5`, `ds6`, `ds6b`, `ds7`, `ds7b`, `ds9`, `ds10`, `ds11`.
- Conciliador: `ds13`, `ds13b`.
- Circuito 2: `ds16-22-circuito2-odoo-sync`.
- Fases apagadas y ajustes por faltante: `ds27-29`, `ds-grants-explicitos-f6f7`, `w2`, `w2b`, `w2c`.
- **Scheduler y backoff del worker (hallazgo de W3): `w3-odoo-sync-cron-backoff`** — sin esta migración ningún evento se publica solo y los reintentos martillean Odoo sin espera.
- **`ds9` trae un data-fix de datos** (`scripts/data-fixes/2026-11-16-ds9-incompletos-falsos.mjs`): correr primero en dry-run contra prod con consultas solo-SELECT y revisar el conteo antes de `--apply`.

Verificación tras cada migración: por objeto (columna/función/política existen), no solo «aplicó sin error» (lección CH/CF).

## 2. Edge functions
`node scripts/deploy-edge.mjs --env prod --slug <slug>` para: `odoo-sync` (verify_jwt=false, falla cerrado), `odoo-conciliar`, `odoo-api`. Cada una debe estar antes en dev (`edges_desplegadas`).

## 3. Secrets (en el panel de Supabase de prod, nunca en el repo)
| Secret | Valor / criterio |
|---|---|
| `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY` | los del Odoo **real**, de la cuenta de integración (clave nueva, rotable) |
| `ODOO_HOSTS_ESCRITURA` | solo el host del Odoo real (sin esta variable no se escribe a ningún host) |
| `ODOO_HOSTS_PROD` | el host del Odoo real |
| `ODOO_PERMITIR_PROD` | `true` **solo** cuando Xaviel dé el OK de encender; hasta entonces ausente = toda escritura al Odoo real queda bloqueada aunque lo demás esté encendido |
| `ODOO_ESCRITURA_HABILITADA` | `true` (OC reales); apagarlo devuelve la OC al simulador |
| `ODOO_COMPANY_ID` | compañía de la cuenta (verificar, no asumir) |
| `ODOO_SYNC_SECRET` | opcional; el cron entra con `infra_sync_secret` (ya existe en el vault) |

## 4. Crons (los crea la migración; verificar que existan y estén activos)
- `sgc-odoo-sync` — cada minuto; solo llama a la edge si hay eventos reclamables.
- `sgc-odoo-conciliar-diario` (09:30 UTC) y `sgc-odoo-conciliar-sondeo` (cada 5 min).
Verificar: `select jobname, schedule, active from cron.job where jobname like 'sgc-odoo%'` (solo lectura). Requieren `vault.secrets` con `infra_sync_secret` (ya existe) y la URL de edge (`sgc.edge_url`).

## 5. Datos de homologación (data-fixes versionados con fecha, dry-run primero)
1. **Instancia del Odoo real**: registrar la instancia (la identidad es inmutable) y, **solo si procede**, re-apuntar vínculos como hizo `scripts/data-fixes/2026-11-16-ds-homologacion-dev.mjs` para staging. Necesita un data-fix nuevo, fechado, **solo SELECT en dry-run**, que resuelva todo por código/nombre contra el Odoo real (nunca copiar ids de staging: coinciden por ser copia, pero se verifica).
2. **Bodegas ↔ almacenes** (`codigo_odoo`, `odoo_warehouse_id`, `odoo_location_id`): mismo mapa verificado contra `stock.warehouse` real. Un almacén sin bodega SGC se deja «no gestionado» (no se crea).
3. **Cuentas analíticas**: confirmar con Contabilidad las 10 «seguras» y resolver las 4 dudosas (ver ODOO-INTEGRACION-AVANCE, DS-06) **antes** de que alguna OC pueda imputarse. En prod solo cuentas con `confirmado=true` (`odoo_analitica_confirmar`, admin).
4. **Catálogo**: solo los artículos con propuesta **aprobada por una persona** en Tecnología › Homologación; nada vincula solo. Los artículos sin `odoo_product_id` bloquean el conduce con un mensaje que lo dice.
5. **Aprobaciones/ratificaciones**: un admin ratifica los ADR 4, 5, 10, 11 y 15 (`odoo_ratificar_adr`). El canary exige el par de almacenes, los artículos y los usuarios piloto en `odoo_fases.config`.

## 6. Permisos mínimos de la cuenta de integración en el Odoo real
La política del cliente (`_shared/odoo-client.ts`, lista blanca por modelo/método) limita lo que SGC puede hacer, pero la cuenta debe tener en Odoo, como mínimo: lectura de `stock.warehouse`, `stock.location`, `stock.quant`, `stock.move`, `stock.picking(.type)`, `product.product`, `res.partner`, `res.users`, `hr.employee`, `purchase.order(.line)`, `account.analytic.account`; escritura (create/write/acciones) de `stock.picking`, `stock.move`, `stock.quant` (solo inventario por acción de negocio), `purchase.order`, `mail.message` (chatter) e `ir.attachment` (PDF del conduce). **Sin** `unlink` en ningún modelo. En staging la cuenta **sí** pudo crear `stock.location` (así se hicieron las cuarentenas); en el Odoo real eso es configuración de Odoo y la hace un humano (ver §7), la integración no debe tenerlo.

## 7. Ubicaciones de cuarentena que habría que crear en el Odoo REAL (requiere OK explícito de Xaviel; solo descripción)
Una ubicación **interna**, fuera del stock disponible, por cada almacén vinculado, con nombre estándar `Cuarentena SGC <código de almacén>` y como padre la **vista** del almacén. Las 15 que se crearon en staging corresponden a los almacenes vinculados con SGC: ADM11, ALMA, BCC, CITY, INT, MONT, Olea, POSE, RIVI, RSR, SOLSC, TA, VC, VOLAR y WH. Criterio de arranque: crear solo las de los almacenes que entren en el canary (por ejemplo WH y TA) y el resto al expandir.
Después, enlazarlas con un data-fix fechado (`scripts/data-fixes/2026-11-16-ds-cuarentena-dev.mjs` es el patrón: resuelve por nombre + padre contra el Odoo, sin ids en el repo; para prod habría que copiarlo a un archivo prod y quitarle la guardia de «solo dev», con dry-run primero). Sin la ubicación, los retiros quedan «pendiente» con motivo y el material dañado **nunca** se manda al stock disponible.
Ojo: el script `scripts/odoo-cuarentena-staging.mjs` **no debe usarse en prod** (su guardia lo rechaza: exige un staging reconocible).

## 8. Encendido por etapas (cada una, con OK nombrado; apagar es siempre posible)
1. Instancia: `permitir_entrada`/`permitir_salida` (por etapa, ver docs/ODOO-CIRCUITO2.md §«Pasos físicos»).
2. Política por tipo, en este orden: `salida_inventario` (canary) → `entrada_inventario` → `conduce_externo` → `retiro_material` → `conteo_inventario` → `ajuste_faltante`.
3. Fases: `canary` (par de almacenes + artículos + usuarios piloto) → observar criterios de salida (`odoo_canary_criterios`) → `expansion` → **`corte` solo con decisión aparte** (apertura por bodega y proyección de stock).
4. Por cada etapa: conciliador diario sin deriva (Tecnología › Conciliación) y cero eventos en `incierto`/`error` antes de pasar a la siguiente.

## 9. Reversa (resumen; detalle en ODOO-RUNBOOK-REVERSA.md)
Apagar política por tipo → `permitir_*=false` → quitar el host de `ODOO_HOSTS_ESCRITURA` (corta toda escritura). Los documentos en prueba se compensan en Odoo solos al pasarlos a «prueba»; una recepción de OC ya validada la revierte Compras en Odoo.

## 10. Datos y terceros (CI13)
La integración envía a Odoo nombre/correo del autor en el chatter, cuentas, productos y el PDF firmado del conduce (firmas y fotos). Revisar `docs/DATOS-Y-TERCEROS.md`, la política de privacidad y los formularios de tienda **antes** de encender en prod.
