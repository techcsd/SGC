# AS3 — Rediseño de Sistema › Estadísticas + fix del reporte de versión (propuesta v1)

> Apunte: la versión que reporta cada usuario está **desfasada** (Xaviel marca 1.86.0 pero tiene 1.90) y la interfaz hay que mejorarla.

## Diagnóstico (verificado — raíz confirmada)
- La versión por dispositivo se escribe **solo** cuando el cliente llama `sgc.set_mi_plataforma(plataforma, modelo, app_version)`. El upsert hace `app_version = coalesce(excluded.app_version, existente)`.
- La lectura (`dispositivos_por_usuario`) toma la **versión no-nula más reciente** de `usuario_dispositivos`.
- **Conclusión:** si la app arranca alguna vez llamando `set_mi_plataforma` **sin** `app_version` (overload de 2 args / null), la versión vieja no-nula **nunca se sobrescribe** → se queda pegada en 1.86.0. **No es** el escenario del service-worker; es el contrato de reporte. Los rows del backfill (AR2) también nacieron sin versión.

## Fix del contrato (el arreglo real)
- **App (PROMPT-2):** llamar `set_mi_plataforma(plataforma, modelo, app_version, build_number)` con la versión **en CADA arranque y al volver de background** (barato, idempotente por dispositivo, tolerante a offline por outbox). Nunca mandar null si se conoce la versión.
- **Web:** al arrancar la web ya se conoce su versión (`version.ts`) → reportarla igual en cada carga autenticada.
- **Backend (aditivo):** `usuario_dispositivos.build_number` + `last_seen_at` explícito; y un pequeño ajuste para que un reporte con versión nueva siempre gane (ya lo hace por `visto_at desc` + no-null, basta con garantizar que la app mande no-null).
- Sin este contrato, el dato **no se puede interpretar** → por eso el rediseño muestra siempre **"última vez visto"** junto a la versión.

## Rediseño de la interfaz (hoy es tabla plana)
1. **Fila de KPIs** arriba: Usuarios activos hoy / 7d · Dispositivos · % en la **última versión publicada** (evento AQ1) · nº de plataformas.
2. **Gráfico de distribución por versión** (barras — reutiliza `shared/ui/bar-chart`): cuántos usuarios/dispositivos por `app_version`, resaltando la publicada.
3. **Tabla filtrable/ordenable**: usuario · rol · plataforma · versión · **última vez visto** · dispositivo/modelo. Con búsqueda y export (reutiliza `app-export-excel`).
4. **Señal de "versión obsoleta"**: badge rojo cuando la versión del usuario < la publicada, y "sin datos" honesto cuando `app_version` es null (distinto de "obsoleta").
5. **Frescura**: "última vez visto" como "hace N min/h/días" (mismo helper `haceCuanto` de seguimiento).

## Alcance de construcción (si apruebas)
- **Frontend:** rediseñar `tecnologia/estadisticas` (KPIs + bar-chart + tabla con filtros/orden/export/badges). Reusa `bar-chart`, `export-excel`, `haceCuanto`.
- **Backend (mínimo):** `usuario_dispositivos.build_number` + exponer `last_seen_at` y "obsoleta vs publicada" en `dispositivos_por_usuario` / `estadisticas_uso`.
- **Contrato para PROMPT-2:** reporte de versión en cada arranque/background (documentar).

## Decisiones que necesito de ti
- ¿OK al layout (KPIs + barras por versión + tabla con export)?
- La señal de "obsoleta" la comparo contra la **versión publicada** (evento AQ1) por plataforma — ¿correcto?
