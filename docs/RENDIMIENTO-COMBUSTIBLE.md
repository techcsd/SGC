# Rendimiento de combustible — reglas de clasificación (AD7, 31/07/2026)

El sistema clasifica cada echada en **4 estados** en vez del antiguo booleano
`alerta_consumo`. La regla madre: **el rendimiento solo es confiable de tanque
lleno a tanque lleno y con una distancia mínima significativa.**

## Estados

| Estado | Significado | Alerta email |
|---|---|---|
| `datos_insuficientes` | No se puede medir de forma confiable | No |
| `optimo` | Dentro de lo esperado para el vehículo | No |
| `bajo` | Por debajo de lo normal pero explicable — vigilar | No |
| `anormal` | Fuera de rango físico o gran desviación → posible fuga/robo/falla/error | Sí (Flota) |

## Orden de evaluación (primer match gana)

1. **Datos insuficientes** si:
   - Es la primera echada del vehículo (sin distancia previa), o
   - La distancia recorrida `< dist_min_km` (equipos por horas: `< dist_min_horas`), o
   - La echada (o la anterior) **no fue a tanque lleno**, o
   - Galones ≤ 0 / no calculable.
   > **El caso real de la echada a 10-11 km cae aquí** — jamás "óptimo".
2. **Anormal** si:
   - `rendimiento < piso` (mínimo coherente) o `rendimiento > techo` (máximo coherente
     → probable error de odómetro o echada anterior no registrada), o
   - Hay baseline y la desviación (en cualquier sentido) `> umbral_anormal_pct`.
3. **Bajo** si hay baseline y el rendimiento está entre `umbral_consumo_pct` y
   `umbral_anormal_pct` por debajo del baseline.
4. **Óptimo** en cualquier otro caso.

## Baseline (referencia por vehículo)

- Se usa `vehiculos.rendimiento_esperado_km_gal` si un admin lo definió.
- Si no, el **promedio de las echadas plausibles** del propio vehículo (distancia ≥
  `dist_min_km` y rendimiento entre piso y techo), solo si hay al menos
  `min_registros_baseline`. **Nunca** se promedian echadas de corta distancia u
  outliers → así el baseline no se "envenena" (bug histórico).
- Equipos por horas (`medida_uso='horas'`, p. ej. telehandler): se mide en **h/gal**
  con `dist_min_horas`, `rendimiento_min_horas_gal` y `rendimiento_max_horas_gal`.

## Umbrales (tabla `sgc.flota_config`, editables en Flota › Combustible › ⚙️ Umbrales)

| clave | default | qué controla |
|---|---|---|
| `dist_min_km` | 50 | km mínimos entre echadas (km) |
| `dist_min_horas` | 3 | horas mínimas entre echadas (equipos por horas) |
| `rendimiento_minimo_km_gal` | 10 | piso absoluto km/gal |
| `rendimiento_maximo_km_gal` | 35 | techo absoluto km/gal |
| `rendimiento_min_horas_gal` | 0.05 | piso h/gal (equipos por horas) |
| `rendimiento_max_horas_gal` | 1.0 | techo h/gal (equipos por horas) |
| `umbral_consumo_pct` | 20 | % bajo el baseline → "bajo" |
| `umbral_anormal_pct` | 40 | desviación ± del baseline → "anormal" |
| `min_registros_baseline` | 3 | echadas plausibles mínimas para confiar el promedio propio |

## Implementación

- Helper puro `sgc.clasificar_rendimiento(medida, km_rec, galones, rend, baseline, tanque_lleno)`
  → `(estado, motivo)`. Lo usan el insert y el recálculo (una sola fuente de verdad).
- `sgc.registrar_combustible_app` (misma firma de 19 args) clasifica al insertar y
  guarda `estado` + `motivo_alerta`; `alerta_consumo = (estado='anormal')` (retrocompat).
- `sgc.recalcular_estados_combustible()` (admin) reclasifica el histórico.
- `sgc.set_flota_config(clave, valor)` (admin/flota) edita los umbrales.
- La UI muestra un badge por estado y un **tooltip = `motivo_alerta`** explicando el POR QUÉ.

## Pendiente (mejora futura, no bloqueante)

Captura de **tanque lleno vs parcial** por echada (columna `registros_combustible.tanque_lleno`
ya existe, hoy default `true`). Con ella se acumularían los galones de echadas parciales
entre llenados para un cálculo full-to-full exacto. Hoy se trata cada echada como tanque lleno.
