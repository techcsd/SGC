# ACTUALIZACIONES.md — por qué la app se "frizó" (CO1, PROMPT-98, 14/10/2026)

> Nota corta, honesta, para responder "¿qué pasó en 2.44/2.45 que causó tantos
> estragos de actualización, tanto en Android como en la web?" (#211).

## Android (APK) — causa conocida, ya arreglada en el build, NO se arregla sola

Los APK **2.44.0, 2.44.1 y 2.45.0** salieron con el canal interno marcado como
`"pwa"` en vez de `"play"`/`"apk"` (un `fileReplacements` de `angular.json` pisaba
el parche de `scripts/build-env.mjs` que debía fijarlo). Con canal `"pwa"`, el
botón **"Actualizar"** de esos tres APK hace `location.reload()` — que vuelve a
cargar los **mismos archivos de adentro del APK**: la pantalla "carga" un
segundo y no pasa nada. El usuario ve que "busca actualización" mintiendo.

Esto se arregló en el build a partir de **2.46.0** (commit `2c6f75f`, canal real
en `canal.generated.ts` + candado para que no vuelva a pasar) y en su momento
(08-oct, CL4) se mandó un rescate a 8 usuarios/9 equipos (push + aviso en
`/app-movil`). **Pero un APK con el bug ya instalado no se puede arreglar a
distancia** — ningún código nuevo que publiquemos llega a un botón que solo
recarga lo viejo. La única salida es que la persona **desinstale y reinstale**
(o instale encima) un APK nuevo, descargado a mano.

**Quién sigue en el APK roto hoy (14-oct, F0 de PROMPT-98):**

| Usuario | Versión | Equipo | Última vez visto |
|---|---|---|---|
| FELIX DELGADO | 2.45.0 | itel C671L | hoy |
| Eduardo NG | 2.45.0 | SM-S948B | hace 18h |
| Miguel Polanco | 2.45.0 | C62 Pro | hace 19h |
| Juan Ocsena | 2.45.0 | SM-A065M | hace 25h |
| Ramon Cabrera | 2.45.0 | SM-S928B | hace 57h |
| Dallin Joel Vido Gutierrez | 2.45.0 | C62 Pro | hace 126h (~5d) |
| Xaviel Terrero | 2.45.0 | SM-A205U | hace 137h (~6d) |

(Hay otras filas más viejas en `usuario_dispositivos` — POLIN RAMIREZ, QA
logística, Papo, MANOLO DURAN (2.4.0), Test User 3 — pero son cuentas de
prueba o equipos que el usuario ya reemplazó por otro donde SÍ está al día;
no son gente realmente atascada hoy.)

**👤 Mensaje de WhatsApp listo (pendiente físico tuyo, pégalo y manda el enlace
corto de `/app-movil`):**

> Hola! 👋 Vi que tu app CSD App (Android) sigue en una versión vieja (2.44/2.45)
> que tiene un error conocido: el botón "Actualizar" no funciona en esas
> versiones específicas. No es nada que hiciste mal — es un bug nuestro que ya
> arreglamos, pero tu teléfono necesita el instalador nuevo a mano UNA vez.
> Por favor entra a este enlace desde tu Android y descarga/instala encima
> (no borra tus datos): https://sgcconstructorasd.com/app-movil
> Después de esa vez, las actualizaciones futuras sí van a funcionar solas.
> Cualquier duda me avisas. Gracias!

## PWA de iPhone — causa probable, arreglo en PROMPT-99 (app)

El servidor SÍ sirve la versión nueva (`ngsw.json` de prod con timestamp del
13-oct, primer chunk coincide con el build 2.50.0 local) — **el problema está en
el teléfono, no en Vercel**. Tres huecos confirmados en el código de la app
(`csd-app/src/app/core/services/update.service.ts`, `ngsw-config.json`,
`app.config.ts`):

1. **No hay manejo de fallas del Service Worker.** Solo escucha `VERSION_READY`;
   si la descarga de la versión nueva falla en el teléfono (`VERSION_INSTALLATION_FAILED`
   o `SwUpdate.unrecoverable`), nadie se entera — ni telemetría ni reintento. La
   PWA se queda en la versión vieja para siempre, en silencio.
2. **Prefetch de 423 archivos (~9 MB) en cada versión.** El grupo `app` de
   `ngsw-config.json` baja TODO (incluidas pantallas que se cargan bajo demanda)
   antes de poder cambiar de versión. Con el sistema de movimiento (CJ, 2.45) y
   apoyo de transporte (CK, 2.46) el paquete creció bastante; si iOS suspende la
   PWA antes de que termine de bajar, la actualización nunca se completa.
3. **El Service Worker se registra 30 segundos después de abrir** (`registrationStrategy:
   'registerWhenStable:30000'`). Si el chofer abre y cierra la app antes de esos
   30s (común en el campo), ese día no se revisa nada.

**Arreglo:** PROMPT-99 (app, FASE 1) — escuchar las fallas + auto-reparación
(`unregister()` del SW + borrar `caches`, **nunca** IndexedDB donde vive el
outbox) + `registerImmediately` + prefetch solo del núcleo (`index.html`,
`main-*.js`, `polyfills-*.js`, `styles-*.css`) con el resto en un grupo `lazy` +
botón "Reparar la app" en Perfil. El servidor ya soporta una **versión mínima
por plataforma** distinta para `ios-pwa` (`sgc.version_publicada(p_plataforma)`,
`sql/2026-10-14-co1-version-minima-plataforma.sql`) — la app debe empezar a
registrarse con `plataforma='ios-pwa'` (hoy todo cae a `'movil'`, compartiendo
fila con Android) para que esa mínima tenga efecto real.

## SGC (web) — ¿tiene el mismo hueco?

**No.** `grep -rn "SwUpdate\|ngsw\|service-worker"` en `src/` y `angular.json`
no encuentra nada: el SGC web **no usa Service Worker ni `@angular/service-worker`**.
Es una SPA normal servida por Vercel sin caché de cliente propio — el usuario
siempre recibe el HTML/JS del último deploy en la siguiente carga (a lo sumo el
caché del navegador, que un refresh normal resuelve). No hay "frizado" posible
del mismo tipo aquí; el único reporte de error cercano en la familia (`'text/html'
is not a valid JavaScript MIME type`, `error loading dynamically imported module`)
es de la **app** (chunk de csd-app), no del SGC — ver CO7.

## Sistema › Versiones de la app

Columna **"Atascado"** nueva en Dispositivos (`sgc.dispositivos_listado()`):
Android siempre atascado si sigue en &lt;2.46.0; cualquier plataforma, si su
versión es vieja y lleva &gt;48h sin reportarse. Filtro por plataforma y por
"solo atascados". **Botón "Copiar mensaje de WhatsApp"** (CP4, 16-oct) en cada
fila Android atascada: copia al portapapeles el mensaje de arriba, personalizado
con el nombre, listo para pegar junto con el enlace de `/app-movil`.

## CP4 (16-oct) — sigue el mismo problema, #232 es #211 otra vez

Re-corrido el diagnóstico de CO1 dos días después (`scripts/diagnosticos/2026-10-14-co-diagnostico.mjs
--env prod`, solo lectura): **nada cambió**. Los mismos **7 equipos Android** de
la lista de arriba siguen en 2.45.0 (FELIX DELGADO, Eduardo NG, Miguel Polanco,
Juan Ocsena, Ramon Cabrera, Dallin Joel Vido Gutierrez, Xaviel Terrero) — el
WhatsApp pendiente desde el 08-oct (CL4) todavía no se mandó. Snapshot completo
en `qa/cp4-dispositivos-prod.md`.

**El bloqueador real no es un bug nuevo, es un paso pendiente:** el arreglo de
PWA de iPhone (auto-reparación del Service Worker, ver arriba) está en la app
**2.51.0**, que lleva en `dev` desde el 15-oct **sin publicar** — prod sigue en
2.50.0. Mientras 2.51.0 no suba, ningún iPhone puede recibir el arreglo, y los
7 Android de la lista solo se arreglan con el mensaje + instalar encima a mano.
**Orden correcto (ver CONTEXTO-ACTUALIZACION-49 §D):** 1) publicar 2.51.0 con
las 2 pruebas de teléfono (Samsung 2.50→2.51, iPhone 2.50→2.51) → 2) revisar
"Atascados" a las 24h y 48h de publicar → 3) recién ahí, si siguen quedando
iPhone atascados, activar el plan de rescate del service worker (`ngsw-real.js`
+ `safety-worker.js`, preparado pero NO activado todavía — solo hace falta si
el paso 1-2 no basta). 👤 Pendiente físico de Xaviel: mandar el WhatsApp a los
7 Android y probar 2.51.0 para poder publicarla.
