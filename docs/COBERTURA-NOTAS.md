# COBERTURA DE NOTAS — carpeta `imp 11102026` (11-oct 2026) — tanda CN (+ cierre de CM)

> **Regla:** cada párrafo que Xaviel pega aparece aquí una vez por tanda, con:
> - su ID;
> - dónde vive en los prompts;
> - su estado real.
>
> Si una nota no está aquí, es un error de este documento. La numeración global sigue a `..\imp 09102026\COBERTURA-NOTAS.md` (filas 193-202, CM).
>
> **Tanda CN** (11-oct): 13 párrafos.
> - **5 nuevos** → filas 203-207;
> - **8 repetidos literalmente** de CM → sin fila nueva, tabla de abajo con su estado real;
> - **3 hallazgos** del diagnóstico → filas 208-210.
>
> Mocks en `mock-cn\` (lienzo **"SGC + CSD App — Momentos a pantalla completa (CN)"**); contexto `CONTEXTO-ACTUALIZACION-47.md`; prompts `PROMPT-96-SGC.md` y `PROMPT-97-CSD-APP.md`.

| # | Nota (literal) | Fecha | ID | Dónde vive | Estado |
|---|---|---|---|---|---|
| 203 | *"una vez seleccionada la ubicacion o de origen o de destino se deberia replefgar todo eso, para sacarlo de la vista ya que no es necesario seguir viendolo si ya se completo."* | 11-oct | **CN1** | CONTEXTO-47 §A (`rutas.html:252,291,329`; app `crear-ruta.html:93,106,143`, `destino-selector.html:21`) · mock `CN1-ubicacion` · **PROMPT-96 F5** · **PROMPT-97 F4** | 🆕 |
| 204 | *"por que las animaciones no estan en la web sgc? acabo de crear rutas y registrar combustible y no vi ninguna animacion, como si pasa en la csd app."* | 11-oct | **CN2** | CONTEXTO-47 §B (web: 10 disparadores vs ~30 en la app; `combustible.ts:794` y `rutas.ts:702` sin disparador) · **PROMPT-96 F4** · PROMPT-97 F0 (lista de paridad) | 🆕 · causa confirmada |
| 205 | *"in thw web seeing it on android device, the menu opens only with the icons, the users cant see the names of the icons(labels or titles) of that sections. so its difficult to them to know which select."* | 11-oct | **CN3** | CONTEXTO-47 §C (`shell.ts:534-541` colapsa en teléfonos + especificidad de `.shell.collapsed .shell-sidebar`) · mock `CN3-menu-movil` · **PROMPT-96 F2** · PROMPT-97 F0 | 🆕 · causa confirmada · 👤 probar en tu Android |
| 206 | *"i joined to the csd app, and in the first configuration the app call me "ingeniero" but im admin, so why it call me "ingeniero"? lets check it and fix it."* | 11-oct | **CN4** | CONTEXTO-47 §D (`bienvenida.service.ts:127-161`: decide por módulos, "obra" antes que admin) · **PROMPT-97 F2** · PROMPT-96 F3 (contrato de perfiles) | 🆕 · causa confirmada |
| 207 | *"las animaciones nuevas estan bien, pero son solo un simple badge animado que sale abajo, eso puede pasar por desapercibido. hagamoslo como hicimos con las animaciones de conduce y ruta, algo a pantalla completa y con mas animacion y enfoque. en la web la animacion del camion y la calle no esta saliendo, chequear porque y arreglarlo."* | 11-oct | **CN5** | CONTEXTO-47 §B (web: `celebracion.html` solo tiene la escena del conduce; `rutas.ts` no llama) + §E · mocks `Main` + `Escena` · **PROMPT-96 F4 (camión) + F6** · **PROMPT-97 F5** | 🆕 · 👤 OK al lienzo |
| 208 | *(diagnóstico, no es nota)* En la web casi no se pusieron disparadores de momentos al hacer CL2 (el HANDOFF lo dejó como "mecánico, pendiente"); no hay tabla de paridad web↔app de disparadores | 11-oct | **CN2** | CONTEXTO-47 §B · PROMPT-96 F4.1, F4.4 | 🆕 |
| 209 | *(diagnóstico, no es nota)* **CM7 web no usa las pantallas reales**: se hizo con formularios simplificados ("runner por esquema"), no con el cliente de práctica sobre las pantallas reales que pedía CONTEXTO-46 §G.1. Faltan 2 misiones web (aprobar requisición, generar documento) | 11-oct | **CM7** | CONTEXTO-47 §F · PROMPT-96 F1.6 · PROMPT-97 F1.4 | 🆕 · desvío del plan |
| 210 | *(diagnóstico, no es nota)* Los videos v2 se hicieron con **Remotion** (`tutoriales/motion/`), cuya licencia exige pagar para empresas de más de 3 personas. Además, el `HANDOFF.md` y la matriz del repo SGC **no registran nada de CM** | 11-oct | **CM3** | CONTEXTO-47 §0, §F · PROMPT-96 F0, F1.5 | 🆕 · 👤 decidir licencia |

## Notas repetidas hoy (literales, sin fila nueva)

| Nota (literal) | Fila original | ID | Estado real al 11-oct | Dónde se cierra |
|---|---|---|---|---|
| *"lets create a video that explain to users how to install the csd app on android, and how to install on iPhone, that gonna be two separated videos for to different publics, because the way the app works in android is no the same way as it works on iPhone. so lets do it. u can ask me whatever u want."* | 193 | CM1 | Web ✅ (2 videos + botón en `/app-movil`, 1.176.0). App 🟡 (F5). ¿En prod? por verificar | PROMPT-96 F1.4 · PROMPT-97 F1.3 |
| *"lets add in the sgc web and csd app, a animated loggin, meaning when a user login, the app logo must be animated, like a logo reveal u know. u can see examples of what im talking about in this video: https://www.instagram.com/reel/DctfWOITj85/?rpxt=NnM5cmI3cWpxc3d3"* | 194 | CM2 | Web ✅ 1.169.0. App ✅ en dev, sin shipear; falta `csd-logo-texto.svg` | PROMPT-96 F1.3 · PROMPT-97 F1.1, F3 |
| *"the video preview are not working good in "dudas", and i think there is a better way to show that section, i dont know if is the structure or the organization or what, but i think it doesn't have a goog ui/ux. and why that videos doesn't have sound? that videos nee to be more interactive like a youtube video, have effects on screen and all that stuff. These videos doesn't say nothing, dont have text on screen, follow ups, dont do close up to certains things that need be focused... these videos are just boring videos that i can do in a 30 seconds just recornding my screen and doing a workflow without talk and without (senalar) what im doing... thats bad, that videos need to be dynamic, en usefull... and why is not a videos of the workflows of "Uso de vehiculo" and "Registrar combustible"."* | 195 | CM3 | Web ✅ 13 videos v2 + teatro + descargar/compartir. App 🟡 F5. Verificar videos de app y prod | PROMPT-96 F1.4-F1.5 · PROMPT-97 F1.3 |
| *"see all that space that is not used in "Dudas" module."* | 196 | CM3 | ✅ 1.170.0 | — |
| *"raykler still having the issue when he tries to transfer a "Conduce" to Misael. he says this: "Brother pero no pueden firmarlo por que aun no lo reciben y para eso tengo que decirle al chofer que lo lleve". lets find a solution for that, and prevent that not gonna happens again."* | 197 | CM4 | ✅ servidor + web 1.167.1 en prod. App ✅ en dev, sin shipear | PROMPT-97 F3 (2.48.0) · 👤 confirmar con Raykler |
| *"I must be able to open the profile pic of an use or a "conductor" of the sgc or csd app. i cant see that profile pic in a big view acttualy just the normal little circle  u see in the image."* | 198 | CM5 | Web ✅ 1.168.0. App ✅ en dev, sin shipear | PROMPT-97 F3 (2.48.0) |
| *"Misael adn raykler want to put up the maximum quantity of points that the "choferes" can reach on their activities, in order to give them their "incentivos". and Misael must be able to approve or not approve that incentivos."* | 199 | CM6 | Web ✅ 1.172.0. App ⛔ falta `cm6b`. Rol de Misael por verificar | PROMPT-96 F1.1 · PROMPT-97 F1.2 |
| *"The sgc system and the csd app needs "Demo", for example a CSD App demo, that the users can use to practice the real workflows that the real app has. that demo app must show a puntuable record that the user gonna reach, like an examen. the app must give feedback of how the user did, show animations and all that stuff. the same in the web.  u can ask me question about it and how we gonna do it, in order to give u more information and instructions."* | 200 | CM7 | Web 🟡 6/8 misiones, **no con pantallas reales** (fila 209). App ⛔ | PROMPT-96 F1.2, F1.6 · PROMPT-97 F1.4 |

**Pendientes físicos de Xaviel (tanda CN):**
1. Mirar el lienzo **"SGC + CSD App — Momentos a pantalla completa (CN)"** (11 escenas, el selector plegado, el menú del teléfono). Si no dices nada, va tal cual.
2. Probar en tu Android la web con el menú arreglado (CN3).
3. Ver otra vez la bienvenida de la app con tu usuario admin (*Soporte y ayuda › Ver la bienvenida otra vez*) cuando salga 2.48.0.
4. **Remotion:** comprar la licencia de empresa, o decir que el motor de videos se pase al gratis (Playwright + ffmpeg) antes de la próxima regrabación.
5. Confirmar con Raykler que ya transfiere (CM4 está en prod desde 1.167.1).
6. Probar el piloto de práctica de la app (combustible) y la primera misión web con pantalla real.
7. OK a cada versión (parche web, 2.48.0, la siguiente).
