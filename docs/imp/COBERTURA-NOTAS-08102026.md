# COBERTURA DE NOTAS — carpeta `imp 08102026` (08-oct 2026, noche →) — tanda CL

> **Regla:** cada párrafo que Xaviel pega aparece aquí una vez por tanda, con:
> - su ID;
> - dónde vive en los prompts;
> - su estado real.
>
> Si una nota no está aquí, es un error de este documento. La numeración global sigue a `..\imp 07102026\COBERTURA-NOTAS.md`: filas 141-184 (CI, CJ, CK). Sus pendientes físicos siguen allá.
>
> **Tanda CL** (08-oct, noche):
> - 6 notas: filas 185-190;
> - 2 hallazgos del diagnóstico que no son notas: filas 191-192;
> - capturas en `adjuntos-cl\`;
> - mocks en `mock-cl\`;
> - contexto `CONTEXTO-ACTUALIZACION-45.md`;
> - prompts `PROMPT-92-SGC.md` y `PROMPT-93-CSD-APP.md`.

| # | Nota (literal) | Fecha | ID | Dónde vive | Estado |
|---|---|---|---|---|---|
| 185 | *"lets improve how "Nuevo conduce externo" looks. its actually looks without care and cavernicola as u can see in the image."* (captura `adjuntos-cl\CL1-conduce-externo-actual.png`) | 08-oct (noche) | **CL1** | CONTEXTO-45 §B · mock `CL1-conduce-externo` · **PROMPT-92 F2** | 🆕 · 👤 OK al mock (si no, va tal cual) |
| 186 | *"and me as an admin must be able to mark a new one as a test."* | 08-oct (noche) | **CL6** | CONTEXTO-45 §B·4 · mock `CL1-conduce-externo` (interruptor) · **PROMPT-92 F3** · **PROMPT-93 F2** | 🆕 |
| 187 | *"lets add more animations and things, include in the web... not only in the sgc web. lets add animations and movement and all that stuff in more modules, for example in Requisiciones, entradas, salidas, conduces externos, conduces, ordenes de compra, mantenimiento, condcutores, combustible, echar combustible, checklist, rutas, insopeccion de vehiculo, accidente, solicitud de movimiento, nueva bitacora, mis bitacoras, ordenes de trabajo, mi proyecto, requisicion, solicitud de compra, confirmar entregas, mensajes, notas, soporte, expedientes, contratos, aprobaciones, firmas pendientes, configuracion, generar documento, plantillas, historial, seguimiento, rutas, personal de obra, cargos y alias, reportes de clima, proyectos, empleados, asistencia, ausencias y vacaciones, articulos, categorias, activos fijos, entradas, salidas, requisiciones, retiros de material danado, movimientos, conduces, conduces exrternos, proveeedorers de transporte, lugares por registrar, confirmaciones de entrega, material no catalogado, conduces por implementar, conteos y ajustes, apertura de inventarios, reposicion, almacenes, uso d vehiculo, registro de combustible, multas, mantenimientos, inspeccion de vehiculo, mi recorrido, rutas activas, registro de echadas, por aprobar, vehicluos, conductores, incentivos, and so on... i hope u understood."* + respuesta en sesión: **"También la CSD App"** | 08-oct (noche) | **CL2** | CONTEXTO-45 §C (tabla módulo por módulo, web y app) · mock `CL2-patrones-modulos` · **PROMPT-92 F4-F5** · **PROMPT-93 F3-F4** | 🆕 · 👤 OK al mock |
| 188 | *"the "bienvenida" when a new user arrives, or in a new installation, must be more animated, it must have animations, motions, seeing more smooth, more interactive or modern, do a research in the internet in order to know better how other apps do it."* + respuesta: **"App y web"** | 08-oct (noche) | **CL3** | CONTEXTO-45 §D (investigación NN/g + Appcues) · mocks `CL3-bienvenida-app`, `CL3-bienvenida-web` · **PROMPT-92 F6** · **PROMPT-93 F5** | 🆕 · 👤 OK a los mocks |
| 189 | *"when i tried to update the 2.44 to the 2.45 my android got crashed and dont let me do it, lets find why. i need to uninstall it and download and install it and now it works."* + respuesta: *"le daba al boton de descargar, cargaba y nada pasaba."* | 08-oct (noche) | **CL4** 🔴 | CONTEXTO-45 §A (causa confirmada: el APK dice `canal:"pwa"`) · **PROMPT-93 F1** (hotfix 2.45.1, **antes que PROMPT-91**) · **PROMPT-92 F1** (rescate) | 🆕 · 👤 probar hotfix en Samsung → OK → mandar mensaje de rescate |
| 190 | *"i wanna have a list of the parts or animations that exist in the systems, u can create that submodule inside of "Administracion" module. u can ask me things."* + respuesta: **"Lista + vista previa (Recomendado)"** | 08-oct (noche) | **CL5** | CONTEXTO-45 §E · mock `CL5-catalogo-animaciones` · **PROMPT-92 F7** · **PROMPT-93 F6** | 🆕 |
| 191 | *(diagnóstico, no es nota)* El mismo error de "cavernícola" (`class="sgc-field"` puesto en el control y no en su contenedor) está en **17 controles de 5 pantallas**: conduce-externo-form, conduces, lugares-por-registrar, proveedores-transporte, requisiciones | 08-oct (noche) | **CL1** | CONTEXTO-45 §B · PROMPT-92 F2.1 | 🆕 |
| 192 | *(diagnóstico, no es nota)* **Todo APK desde 2.44.0** (2.44.0, 2.44.1, 2.45.0) sale con `canal:"pwa"`: ningún usuario Android en esas versiones puede actualizar desde la app; el AAB de Play tendría lo mismo; los APK de CK saldrían igual si no se arregla primero | 08-oct (noche) | **CL4** 🔴 | CONTEXTO-45 §A · PROMPT-93 F1 · PROMPT-92 F1 | 🆕 |

**Pendientes físicos de Xaviel (tanda CL):**
1. Mirar el lienzo **"SGC + CSD App — Conduce externo y Bienvenida (CL)"** y decir si algo cambia. Si no dices nada, va tal cual.
2. 🔴 Probar el hotfix 2.45.1 en tu Samsung: actualizar desde la app y el camino de rescate. Luego OK.
3. 🔴 Mandar a los choferes el mensaje de WhatsApp de rescate que trae el reporte (los que estén en 2.44/2.45 deben instalar encima una vez, **sin desinstalar**).
4. Probar en dev la bienvenida (instalación limpia) y las animaciones en un teléfono de gama baja.
5. OK a 1.162.0 / la versión de app que toque.
