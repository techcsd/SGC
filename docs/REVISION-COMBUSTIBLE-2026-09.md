# Revisión a fondo — Combustible (CD8, 30-sep-2026)

> Nota #99: Raykler envió un Excel de `registro-combustible` (sacado de CSD) con filas
> en rojo que Claude marcó como duplicadas. Esta es la revisión larga del área, con los
> hallazgos verificados **contra los datos reales de prod** (read-only, 30-sep) y el
> arreglo (aplicado o DEFAULT). El Excel aún no llegó a `adjuntos/`; cuando esté, se cruza
> fila roja a fila roja con la herramienta *Posibles duplicados* (abajo).

## 0. Números de prod (read-only)
- **273 echadas** totales · **198 importadas** · **106 ya invalidadas** · **73 con `client_uuid`**.
- **`numero_recibo` = 0% poblado** (CC6 creó la columna pero nadie la llena aún).
- **25 pares candidatos a duplicado** (mismo vehículo, fecha ±2 h, galones ±0.5%).

## 1. Hallazgos

| # | Hallazgo | Sev. | Evidencia | Arreglo |
|---|---|---|---|---|
| 1 | **`numero_recibo` sin poblar** → la unicidad/fusión "por recibo" de CC6 **no puede operar**. El match cae en heurística (fecha+galones) o `nro_factura`. | 🔴 alta | `con_recibo=0` de 273 | La app/web debe **capturar el recibo** al registrar (CC6 lo agregó a la echada; falta el input obligatorio-suave). Índice único parcial ya listo (hallazgo 4). DEFAULT: campo recibo en el formulario de echada + backfill desde la foto/factura donde se pueda. |
| 2 | **25 pares duplicados candidatos**, la mayoría `importada↔importada` (el informe de Total Energies trae la misma echada repetida al importarlo) + algunos `manual↔manual` con `client_uuid` distinto (doble envío sin idempotencia total). | 🔴 alta | 25 pares; ej. veh `16aea7c8` con 3 filas de 34.12 gal | Herramienta **Posibles duplicados** (no destructiva, abajo). La corrección de los existentes va **solo con la lista revisada** por Xaviel/Raykler — nunca un script masivo. |
| 3 | **Idempotencia parcial**: solo 73/273 tienen `client_uuid`. Las importadas no lo tienen → **re-importar la misma factura crea filas nuevas** (H3/H4). | 🟠 media | `con_uuid=73` | Idempotencia por `client_uuid` en crear/corregir/reenviar (ya en varios caminos, BZ0). Import: dedup por `(vehiculo_id, numero_recibo)` o hash de fila del informe **antes de insertar**; si casa una echada manual → **fusiona** (enlaza a conciliación) en vez de crear. DEFAULT (pendiente de tocar el importador). |
| 4 | Sin **unicidad** que impida dos echadas vigentes del mismo vehículo con el mismo recibo. | 🟠 media | — | **Aplicado**: índice único parcial `uq_combustible_vehiculo_recibo (vehiculo_id, numero_recibo) where numero_recibo is not null and not invalidada`. Hoy vacuo (0 recibos), future-proof cuando el hallazgo 1 se resuelva. |
| 5 | **Export**: las fotos son columnas sueltas (`foto_recibo_path`, `foto_tablero_path`, `foto_bomba_path`), **no arrays** → el export del SGC (por `log_combustible`, 1 fila/echada) **no multiplica**. Los duplicados del Excel de Raykler son **de la base** (echadas repetidas, hallazgo 2), no del formato del export. | ✅ info | cols reales | Nada que arreglar en el export; los rojos del Excel = duplicados reales a resolver con la herramienta. |
| 6 | **Anulaciones** (galones negativos, BY2) importadas: verificar que las invalidadas (106) incluyan las anulaciones y no cuenten en KPIs. | 🟡 baja | 106 invalidadas | `recalcular_estados_combustible` y `log_combustible` ya **excluyen invalidadas** (regla 13). Revisar en la lista cruzada del Excel. |
| 7 | **Rendimiento km/gal y costo/km**: no deben contar duplicados ni importadas sin km. Al invalidar un duplicado (herramienta), se **recalcula**. | 🟡 baja | — | La herramienta llama `recalcular_estados_combustible()` tras invalidar. Las importadas sin km ya no aportan rendimiento (km null). |
| 8 | **Permisos por rol (CD5)**: el chofer ve las echadas del vehículo asignado (no solo las suyas) — ya cubierto por `puede_ver_echada(...,vehiculo_id)`. | ✅ | ver CD5 | Aplicado en `sql/2026-09-30-cd5`. |

## 2. Herramienta *Posibles duplicados* (aplicada, no destructiva)
`sql/2026-09-30-cd8-combustible-integridad.sql`:
- **`sgc.echadas_posibles_duplicados()`** — pares candidatos (mismo vehículo + fecha ±2 h +
  galones ±0.5%, o mismo `numero_recibo`), excluye invalidadas, reenvíos legítimos y los ya
  marcados "distintas". Devuelve tipo (`mismo_recibo` / `importada_x2` / `manual_x2` /
  `importada_manual`). Gate flota-elevado/admin.
- **`sgc.resolver_duplicado_echada(a, b, decision, invalidar)`** — `misma` = invalida una
  (`invalidada=true` + motivo, **nunca borra**) y recalcula KPIs; `distintas` = recuerda el par
  en `echada_duplicado_descartado` para no volver a sugerirlo.
- Verificado en dev: la detección devuelve pares; la resolución invalida sin borrar.
- **Pendiente (frontend)**: panel "Posibles duplicados" en *Flota › Combustible › Echadas (log)*
  para Raykler/admin (par a par → *Son la misma* / *Son distintas*).

## 3. Pendiente de Raykler/Xaviel
- Poner el Excel en `adjuntos/` → cruzar cada fila roja con la base (¿duplicado real / de export / falso positivo?).
- Revisar los 25 pares con la herramienta antes de invalidar nada en prod.
- Capturar `numero_recibo` al registrar (hallazgo 1) para que la unicidad/fusión funcione.
