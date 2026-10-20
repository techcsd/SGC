# Release 1.195.0

- Equipo/tester: Claude Code (sesión autónoma, ronda CS — PROMPT-106)
- Qué se probó en dev (fzfrnrvndzrjwyvdpkgg), con evidencia real (no solo "debería funcionar"):
  - **CS6/CS7 "Entrar como"**: reproducido con sesiones reales (qa_admin → usuario normal = 200 OK con token_hash; qa_admin → otro admin = 403 "No se puede entrar como otro administrador."; usuario normal → acción admin = 403 "No autorizado..."); confirmado que `error.context.json()` ahora entrega el mensaje real al front (antes siempre caía al genérico de supabase-js). Guard `rechazar_si_cliente_oauth` confirmado: en vivo (dev) solo falla con 42501; las 12 edges (11 admin-* + claude-conexiones) corregidas y redeployadas.
  - **CS3**: lógica de `actualizarEnListaLocal`/`cerrarEditor` revisada por código (inserta si falta, guarda pendiente antes de cerrar); mismo patrón corregido en `nota-editor.ts` (ngOnDestroy ya no descarta el debounce pendiente).
  - **CS1**: orden por columna verificado con 8 tests unitarios (`orden-columnas.util.spec.ts`, nulos al final en ambos sentidos, migración del valor legacy). Comparación Inventario↔Ingeniería documentada.
  - **CS4**: `sgc.mis_sesiones()`/`sgc.cerrar_mi_sesion()` probados con sesiones reales (lista con `es_actual`, IP parcial, intento de cerrar la sesión actual rechazado, cerrar otra sesión real sí funciona y desaparece de la lista).
  - **CS2 grupos**: triggers probados con sesión real — 4 niveles OK, 5º nivel rechazado, ciclo rechazado, borrar un grupo intermedio sube sus hijos al nivel de arriba (verificado el `parent_id` resultante). Integridad cruzada (nota de un usuario con grupo de otro) rechazada.
  - **CS2 imágenes**: bucket `notas-imagenes` probado con sesión real — dueño sube/lee, otro usuario sin acceso NO puede leer ni subir, compartir con permiso "ver" da lectura pero NO escritura. Round-trip Markdown↔TipTap con imagen verificado (`markdown-roundtrip.spec.ts`, caso nuevo).
  - **CS5**: 12 herramientas nuevas + `que_puedo_consultar` probadas por el protocolo MCP real (HTTP, `tools/list`/`tools/call`) contra el edge `mcp` desplegado en dev: un admin ve todo, un usuario normal NO ve `listar_expedientes_legales` (sin módulo legal) pero SÍ ve `mis_notas`/`mis_mensajes`/`que_puedo_consultar` (identidad, sin gate). `scripts/cobertura-conector.mjs` verde (24 módulos/pantallas, todos cubiertos o exentos con motivo).
  - **CS10**: edge `reuniones-mi-calendario` desplegada y probada — hoy responde `{conectado:false, motivo:'no_configurado'}` en dev (estado real: ni dev ni prod tienen la cuenta de servicio de Google configurada, hallazgo nuevo — ver `docs/REUNIONES.md`). No se pudo probar la lectura real de Google Calendar por esto; el resto del flujo (UI, cruce con `google_event_id`, "Llevar al SGC" idempotente) se construyó y compiló pero NO se ejercitó end-to-end con datos reales de Google.
  - `npm run build` (29 guards, incluye el nuevo `cobertura-conector.mjs`) + `npm run test:unit` (89/89, 23 tests nuevos) verdes.
  - 6 migraciones aplicadas a dev y en el ledger (`sgc.migraciones_aplicadas`).
- Versión de origen: 1.194.0.
- Resultado: OK (de mi parte — falta la prueba física de Xaviel en el navegador antes de promover a prod, ver lista en el reporte de la ronda).
- Fecha: 2026-10-19

**Actualización 20-oct-2026:** Claude Code reprodujo "entrar como" con
Playwright real (`ng serve` local contra la base de dev real — no el dominio
`dev.sgcconstructorasd.com`, que está detrás del login propio de Vercel, sin
permiso para generar un bypass) y encontró que el flujo SEGUÍA sin completar
en navegador: el preflight CORS de 40 edges (no solo las 12 del guard)
rechazaba el header `x-sgc-client`. Arreglado (commit `b809772`) y reprobado:
"entrar como" ahora completa de punta a punta (200 + navega como el usuario
objetivo, capturas reales); igual para la nota nueva en la lista, Sesión y
dispositivos con datos reales, y el orden por columna de Requisiciones.

**OK (20-oct-2026, chat):** Claude preguntó explícitamente a Xaviel si
confirmaba promover a prod sabiendo que copiar-imagen-a-Claude-Desktop y el
conector MCP con Claude Desktop real NO los había probado un humano (solo
Claude: Playwright real para lo demás, protocolo MCP crudo para el conector).
Xaviel respondió: **"yes, do it. promote to prod. and do all the stuff."**
— autorización específica e informada, no una frase genérica. CS10 (Google
Calendar) sigue bloqueado aparte (no existe la cuenta de servicio); no es un
riesgo de promover, el edge ya responde `{conectado:false}` con gracia.
