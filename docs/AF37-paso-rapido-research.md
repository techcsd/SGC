# AF37 — Paso Rápido (peajes RD): research + propuesta

> **Estado: PAUSA.** Este documento es la investigación pedida en la FASE 8 del PROMPT‑1.
> No se implementó nada. Xaviel decide opción A vs B antes de construir.

## Qué se buscó
¿Existe una API/portal consultable del sistema **Paso Rápido** (peajes de RD, operado por
Fideicomiso RDVIAL) que permita leer el **balance por TAG** de forma programática?

## Hallazgos (agosto 2026)

- El servicio tiene:
  - Portal de clientes: **https://clientes.pasorapido.gob.do/** (login usuario/contraseña).
  - Sitio institucional: **https://pasorapido.gob.do/** y **https://rdvial.gob.do/servicios/paso-rapido/**.
  - App móvil oficial (iOS/Android) para consultar balance y recargar el TAG.
- El portal y la app permiten **consultar balance, recargar y ver movimientos**, pero
  **con login de usuario** (no hay cuenta de "empresa" con múltiples TAGs documentada
  públicamente).
- **No existe documentación pública de una API REST para desarrolladores** ni endpoints
  de "consultar saldo" abiertos. La tecnología del TAG es SSI Tarvos Pro (multiprotocolo),
  pero eso es del lado del hardware/lectura en caseta, no de una API de balances.
- Recargas: tarjeta por web/app, Carnet (809‑473‑3200 opción 6) o puntos autorizados.

**Conclusión del research:** hoy **no hay una integración automática soportada/oficial**.
Cualquier "integración automática" dependería de *scraping* del portal de clientes
(frágil, sujeto a captcha/ToS, un login por TAG) — **no recomendable** para un ERP que se
mantiene por años.

Fuentes:
- Portal de clientes — https://clientes.pasorapido.gob.do/
- Institucional — https://pasorapido.gob.do/ · https://rdvial.gob.do/servicios/paso-rapido/
- App oficial — App Store id6450284807

## Propuesta a Xaviel — elegir A o B

### Opción A — Integración automática (NO recomendada hoy)
Sólo viable vía scraping del portal de clientes (un login por TAG, frágil, contra ToS).
Alto costo de mantenimiento, se rompe cuando el portal cambia. Recomendación: **descartar**
salvo que RDVIAL provea una API oficial o una cuenta empresarial con export.

### Opción B — Registro manual + balance estimado + alertas (recomendada)
Modelo aditivo por vehículo (paridad con lo que ya hacemos en Flota):
- `paso_rapido_tags` (vehiculo_id, tag_numero, balance_estimado, umbral_alerta, activo).
- `paso_rapido_movimientos` (tag_id, tipo `recarga|consumo`, monto, fecha, nota).
- Balance estimado = recargas − consumos registrados. El chofer/flota registra la recarga
  cuando la hace; los consumos se pueden estimar por ruta/peaje o registrar a mano.
- **Alerta** cuando `balance_estimado <= umbral_alerta`: aviso in‑app + **push (AF7)** +
  panel en Flota. Reutiliza `avisos_flota` y el patrón de umbrales de AD7.
- Respeta `es_prueba`.

Ventajas: 100% soportado, sin dependencias externas frágiles, entrega el valor real que
pidió Xaviel ("alertar cuando quede poco dinero"). Si más adelante RDVIAL abre una API,
la Opción A se puede sumar encima de este modelo sin rehacerlo.

**Decisión pendiente de Xaviel.** Si elige B, se implementa en una ronda posterior
(backend + panel web + captura en la app).
