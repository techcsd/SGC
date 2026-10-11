# COBERTURA DE NOTAS — carpeta `imp 09102026` (09-oct 2026) — tanda CM

> **Regla:** cada párrafo que Xaviel pega aparece aquí una vez por tanda, con:
> - su ID;
> - dónde vive en los prompts;
> - su estado real.
>
> Si una nota no está aquí, es un error de este documento. La numeración global sigue a `..\imp 08102026\COBERTURA-NOTAS.md` (filas 185-192, CL). Sus pendientes físicos siguen allá.
>
> **Tanda CM** (09-oct):
> - 8 notas: filas 193-200;
> - 2 hallazgos del diagnóstico que no son notas: filas 201-202;
> - capturas en `adjuntos-cm\`;
> - mocks en `mock-cm\` (lienzo **"SGC + CSD App — Login, Dudas, Demo e Incentivos (CM)"**);
> - contexto `CONTEXTO-ACTUALIZACION-46.md`;
> - prompts `PROMPT-94-SGC.md` y `PROMPT-95-CSD-APP.md`.

| # | Nota (literal) | Fecha | ID | Dónde vive | Estado |
|---|---|---|---|---|---|
| 193 | *"lets create a video that explain to users how to install the csd app on android, and how to install on iPhone, that gonna be two separated videos for to different publics, because the way the app works in android is no the same way as it works on iPhone. so lets do it. u can ask me whatever u want."* + respuestas: **voz sintética es-DO + música**, **animación 100 % simulada** | 09-oct | **CM1** | CONTEXTO-46 §C · mock `CM1-instalacion` (8+8 escenas con su voz) · **PROMPT-94 F5.6, F6.5** · **PROMPT-95 F5.4** | 🆕 · 👤 llave Azure + música · 👤 ver los videos antes de prod |
| 194 | *"lets add in the sgc web and csd app, a animated loggin, meaning when a user login, the app logo must be animated, like a logo reveal u know. u can see examples of what im talking about in this video: https://www.instagram.com/reel/DctfWOITj85/?rpxt=NnM5cmI3cWpxc3d3"* + respuestas: Instagram bloquea el acceso → **3 variantes en el mock** (default **A · Trazo**); **vectorizar el PNG**; **después de iniciar sesión** | 09-oct | **CM2** | CONTEXTO-46 §D · mocks `Main` + `Logo` · **PROMPT-94 F4** · **PROMPT-95 F4** | 🆕 · 👤 elegir A/B/C (si no, A) · 👤 aprobar SVG vs PNG |
| 195 | *"the video preview are not working good in "dudas", and i think there is a better way to show that section, i dont know if is the structure or the organization or what, but i think it doesn't have a goog ui/ux. and why that videos doesn't have sound? that videos nee to be more interactive like a youtube video, have effects on screen and all that stuff. These videos doesn't say nothing, dont have text on screen, follow ups, dont do close up to certains things that need be focused... these videos are just boring videos that i can do in a 30 seconds just recornding my screen and doing a workflow without talk and without (senalar) what im doing... thats bad, that videos need to be dynamic, en usefull... and why is not a videos of the workflows of "Uso de vehiculo" and "Registrar combustible"."* (capturas `adjuntos-cm\CM3-dudas-actual-*.png`) | 09-oct | **CM3** | CONTEXTO-46 §B · mocks `CM3-dudas`, `CM3-video-estilo` · **PROMPT-94 F5-F6** · **PROMPT-95 F5** | 🆕 · sin sonido por diseño (CK5) · los de app faltan porque PROMPT-91 F6 no corrió |
| 196 | *"see all that space that is not used in "Dudas" module."* | 09-oct | **CM3** | CONTEXTO-46 §B (`dudas.scss:5` `max-width: 780px`) · mock `CM3-dudas` · **PROMPT-94 F5.1-F5.2** · PROMPT-95 F5 | 🆕 |
| 197 | *"raykler still having the issue when he tries to transfer a "Conduce" to Misael. he says this: "Brother pero no pueden firmarlo por que aun no lo reciben y para eso tengo que decirle al chofer que lo lleve". lets find a solution for that, and prevent that not gonna happens again."* (captura `adjuntos-cm\CM4-transferir-error-raykler.png`) | 09-oct | **CM4** 🔴 | CONTEXTO-46 §A (causa confirmada) · mock `CM4-conduce` · **PROMPT-94 F1** (parche, va ya) · **PROMPT-95 F1** | 🆕 · no es la falla de CK6 (esa era el uuid) · 👤 probar con Raykler |
| 198 | *"I must be able to open the profile pic of an use or a "conductor" of the sgc or csd app. i cant see that profile pic in a big view acttualy just the normal little circle  u see in the image."* (captura `adjuntos-cm\CM5-detalle-usuario-foto.png`) | 09-oct | **CM5** | CONTEXTO-46 §E · mock `CM5-foto` · **PROMPT-94 F2** · **PROMPT-95 F2** | 🆕 · fotos viejas a 512 px (límite real) |
| 199 | *"Misael adn raykler want to put up the maximum quantity of points that the "choferes" can reach on their activities, in order to give them their "incentivos". and Misael must be able to approve or not approve that incentivos."* + respuesta: **tope semanal + por actividad** | 09-oct | **CM6** | CONTEXTO-46 §F · mock `CM6-incentivos` · **PROMPT-94 F3** · **PROMPT-95 F3** | 🆕 tope · ✅ aprobar/declinar **ya existe** (AT2/AT3); falta verificar el rol de Misael · 👤 Misael/Raykler ponen los números |
| 200 | *"The sgc system and the csd app needs "Demo", for example a CSD App demo, that the users can use to practice the real workflows that the real app has. that demo app must show a puntuable record that the user gonna reach, like an examen. the app must give feedback of how the user did, show animations and all that stuff. the same in the web.  u can ask me question about it and how we gonna do it, in order to give u more information and instructions."* + respuestas: **simulador local**; notas visibles al **usuario + jefes**; no obligatorio | 09-oct | **CM7** | CONTEXTO-46 §G · mocks `CM7-demo-app`, `CM7-demo-web` · **PROMPT-94 F7** · **PROMPT-95 F6** | 🆕 · por fases (piloto → misiones → panel) |
| 201 | *(diagnóstico, no es nota)* La fase `pendiente_firma` se activa en cuanto hay **receptor designado** (AT16 al crear, CK4 después), **antes de que el material salga**. La web muestra el botón Transferir (`conduce.ts:177-180`) pero el servidor lo rechaza. Además, el chip "Pendiente de firma" sale en conduces que no han salido, y el receptor los ve en "Por firmar" antes de poder firmar | 09-oct | **CM4** 🔴 | CONTEXTO-46 §A · PROMPT-94 F1 · PROMPT-95 F1 | 🆕 |
| 202 | *(diagnóstico, no es nota)* Los videos de la app (pre-uso, combustible, uso de vehículo) **nunca se grabaron**: CK5 solo hizo guiones web y PROMPT-91 F6 no ha corrido. La vista previa falla por: video de ~210 px dentro de la tarjeta, `preload="none"` con póster gris, y duración superpuesta a los controles | 09-oct | **CM3** | CONTEXTO-46 §B · PROMPT-94 F5-F6 · PROMPT-95 F5 | 🆕 |

**Pendientes físicos de Xaviel (tanda CM):**
1. Mirar el lienzo **"SGC + CSD App — Login, Dudas, Demo e Incentivos (CM)"**: elegir la variante del logo (**A/B/C**; si no dices nada, va la **A**) y decir si algo cambia en Dudas, práctica, incentivos o foto. Si no dices nada, va tal cual.
2. 🔴 Probar el parche **CM4** en dev (transferir con receptor designado) y avisar a Raykler cuando esté en prod.
3. Crear un recurso **Azure Speech** (nivel gratis **F0**) y pasar `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` a `.env.local` del SGC. Sin esto, los videos salen con voz **BORRADOR** y no van a prod.
4. Descargar 1-2 pistas de música **libres de derechos para uso comercial** (p. ej. Pixabay Music, instrumental, tranquila) a `SGC\tutoriales\assets\musica\`. Sin pista, los videos salen solo con voz.
5. Ver los 13 videos antes de prod (lista de `docs/TUTORIALES.md` + "¿se oye bien?").
6. Aprobar el SVG del logo frente al PNG (lo trae el reporte). Si la empresa tiene el logo oficial en vector (AI/PDF/EPS/SVG), pásalo y se usa ese.
7. Con Misael y Raykler: poner los **números del tope** (semanal y por actividad) en *Incentivos › Configuración*. La pantalla trae los sugeridos según las últimas 8 semanas.
8. Probar el **modo práctica piloto** (app: combustible; web: crear requisición) antes de que se hagan las demás misiones.
9. OK a cada versión (parche web CM4, 1.164.0, versión de app).
