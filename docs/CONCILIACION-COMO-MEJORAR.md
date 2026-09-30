# Cómo subir el % de match en Conciliación de combustible (para Raykler)

Cuando subes el informe de Total Energies, el sistema intenta **cruzar cada carga del
informe con la echada que registró el chofer**. El **% de match** es cuántas cruzaron.
Lo que no cruza no es un robo: casi siempre es que **falta la echada** o que **falta un
dato** para poder cruzarla.

## Cómo cruza el sistema (3 niveles)
1. **Por número de recibo** — lo más seguro. Si el chofer anota el **Nº de recibo** del
   ticket en su echada, cruza exacto.
2. **Por placa + fecha + galones** — si la placa del informe coincide con un vehículo y
   la fecha/galones cuadran (dentro de la tolerancia).
3. **Por tarjeta → vehículo + fecha** — si la tarjeta está **asignada a un vehículo**.

## Por qué una fila no cruza (y qué hacer)
| Causa | Qué significa | Qué hacer |
|---|---|---|
| **Chofer no registró la echada** | El vehículo se conoce, pero no hay echada de esa carga | **Recordar a los choferes** (botón en el panel) |
| **Tarjeta sin vehículo** | La tarjeta del informe no está asignada a un vehículo | Asigna la tarjeta en el panel de tarjetas |
| **Galones fuera de tolerancia** | Hay echada, pero los galones difieren mucho | Revisa la echada o el ticket |
| **Fecha distinta** | Hay echada del vehículo, pero en otra fecha | Revisa la fecha del ticket/echada |
| **Fuera de flota** | Es una carga de una persona/tarjeta ajena a la flota | No cuenta (no baja el %) |
| **Anulaciones** | Líneas negativas del informe (se cancelan) | No cuentan |

## Para subir el % (lo más efectivo primero)
1. Que los choferes **registren la echada** de cada carga.
2. Que **anoten el Nº de recibo** del ticket (o anótalo tú en el drawer de la echada:
   Flota › Combustible › abrir una echada › **Nº de recibo**).
3. **Asigna cada tarjeta** a su vehículo (así las cargas por tarjeta cruzan solas).
4. Revisa las de **galones/fecha** que salgan en el panel.

## El % del dashboard es honesto
El dashboard cuenta **una factura una sola vez** (la última conciliación de esa factura).
Si vuelves a subir la misma factura, se ve como una **versión** nueva, no se cuenta dos
veces. Por eso el % ya no baja por re-subir.

> El botón **"Recordar a los choferes"** avisa a los que tienen cargas sin registrar.
> La tabla **% por chofer / por vehículo** te dice quién no está registrando.
