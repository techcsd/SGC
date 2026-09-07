# Crons de SGC (pg_cron) — inventario

Todos los `cron.schedule` viven en migraciones (`sql/`). **Hora RD = UTC−4, sin
horario de verano**, así que la conversión es estable todo el año (p. ej.
`0 12 * * *` = **8:00 AM RD**). `cron.schedule` hace **upsert por `jobname`**: si
dos migraciones registran el mismo nombre, gana la última que corrió (no se
duplica la fila).

Fuente de verdad: `select jobid, jobname, schedule, command, active from cron.job`.
Última verificación contra prod: **07/09/2026** (26 jobs activos).

| jobname | schedule (UTC) | RD | qué hace |
|---|---|---|---|
| weather-sync-obras | `0 */3 * * *` | cada 3 h | clima de las obras |
| chequeo-semanal-almacenes | `0 6 * * 1` | lun 2:00 AM | chequeo de almacenes |
| sgc-aplicar-vencimientos | `0 6 * * *` | 2:00 AM | aplica vencimientos |
| sgc-check-domains | `0 */2 * * *` | cada 2 h | dominios |
| sgc-check-subscriptions | `0 */12 * * *` | cada 12 h | suscripciones |
| sgc-cronograma-avisos | `15 6 * * *` | 2:15 AM | avisos de cronograma |
| sgc-fuel-prices | `0 6 * * 6` | sáb 2:00 AM | precios de combustible |
| sgc-huecos-tracking | `*/5 * * * *` | cada 5 min | huecos de tracking |
| sgc-placas-pp-sweep | `15 6 * * *` | 2:15 AM | barrido de placas/PP |
| sgc-obra-avisos | `20 6 * * *` | 2:20 AM | avisos de obra |
| sgc-obra-avance | `30 6 * * *` | 2:30 AM | avance de obra |
| sgc-purgar-posiciones | `30 4 * * *` | 12:30 AM | purga posiciones GPS (retención) |
| sgc-consolidar-recorridos | `50 3 * * *` | 11:50 PM | consolida recorridos del día |
| sgc-transcribe-audio | `*/10 * * * *` | cada 10 min | transcribe notas de voz |
| sgc-reset-almuerzos | `*/5 * * * *` | cada 5 min | reset de almuerzos |
| sgc-recordar-estados-chofer | `5 * * * *` | cada hora :05 | recuerda estado del chofer |
| sgc-recordar-firma-despachante | `0 */2 * * *` | cada 2 h | recuerda firma del despachante |
| sgc-rutas-estancadas | `0 */2 * * *` | cada 2 h | rutas estancadas |
| sgc-recordatorio-solicitudes-movimiento | `0 12 * * *` | **8:00 AM** | recordatorio de solicitudes de movimiento |
| outbox-atascados-diario | `0 12 * * *` | **8:00 AM** | outbox atascados (BG2) |
| **sgc-preaviso-reporte-semanal-sabado** | `0 22 * * 6` | sáb 6:00 PM | pre-aviso reporte semanal (sin alarma) |
| **sgc-recordatorio-reporte-semanal-dia** | `*/30 13-23 * * 0` | dom 9:00 AM–7:30 PM c/30 min | insistencia dominical CON alarma (ver nota) |
| **sgc-recordatorio-reporte-semanal-noche** | `0 0 * * 1` | dom 8:00 PM | cierre dominical con alarma |
| sgc-reporte-semanal-dia | `10 6 * * *` | 2:10 AM | sweep de avisos del reporte semanal |
| sgc-incentivo-semanal-lunes | `0 14 * * 1` | lun 10:00 AM | informe de incentivo semanal |
| sgc-resumen-operaciones-lunes | `0 11 * * 1` | lun 7:00 AM | resumen semanal de operaciones |
| sgc-incentivo-diario | `0 12 * * *` | **8:00 AM** | informe DIARIO de actividad de choferes (BK4, informativo) |

## Nota BK5 — `sgc-recordatorio-reporte-semanal-dia` NO es un cron duplicado

El apunte BK5 lo reportó como "registrado dos veces con horarios en conflicto que
dispara 22 veces cada domingo". Verificado contra prod: **hay una sola fila**
(jobid 12, `*/30 13-23 * * 0`). `cron.schedule` hace upsert por nombre, así que
la migración `al6` (que lo cambió de `0 12,15,18,21 * * 0` a `*/30 13-23 * * 0`)
simplemente reemplazó a la de `af7-af8`/`ak10` — no quedaron dos.

Y las 22 corridas dominicales **son intencionales** (AL6, "Insistencia DOMINGO
cada 30 min de 09:00 a 19:30 RD con ALARMA"): `recordatorio_reporte_semanal(true)`
sólo alarma a los choferes que **aún no enviaron** la inspección
(`... and not coalesce(c.tiene_reporte, false)`, `al6:41`), y va menguando a
medida que la completan. No es spam ni bug → **no se toca**.

Follow-up abierto (§F BK5): si se quiere que los horarios de **informes y
recordatorios** (política de negocio) sean administrables, mover *sólo esos* a una
tabla de horarios; el resto se queda en migraciones.
