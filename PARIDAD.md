# PARIDAD web ↔ app (X13) — documento vivo

Regla madre: **la web (SGC) es el padre**. No puede haber captura de datos que se
haga en la app móvil (`csd-app`) y en la web no. No se busca clonar la UI de la
app, sino **coherencia funcional y de datos** (mismos campos, validaciones y orden
lógico de captura; el layout puede diferir).

> **Ronda BF (01/09/2026):** cerradas 4 capacidades nuevas (personal de obra con
> documentos/contratos, requisición corregible, proveedor con tipos, preferencias
> de avisos) — ver filas 4a–4d y "Decisiones (Ronda BF)".
>
> Estado: iniciado en Ronda 9 (23/07/2026). La auditoría dirigida encontró que
> **el esquema de BD ya soporta casi todo** (ambos RPCs de bitácora escriben una
> fila `bitacora_actividades` por actividad, cada una con su `bloque`). Los gaps
> están en la **capa de formulario/UX de la web** y en la **infraestructura de
> borradores/offline**, no en el esquema.

## Leyenda de clasificación
- **rápido** — cambio pequeño y localizado.
- **mediano** — nueva sección/formulario contra RPC/esquema existentes.
- **requiere decisión** — hay que decidir arquitectura/UX antes de construir.

## Matriz de capacidades (foco: captura de datos)

| # | Capacidad | App | Web | Gap | Clase | Estado |
|---|---|---|---|---|---|---|
| 1a | Múltiples bloques/sujetos en un parte de bitácora | Sí (loop sujeto→actividades) | **Sí (Ronda 9)** — actividades por `(bloque·estructura·actividad)`, repetibles por bloque | — | requiere decisión | **✅ cerrado R9** |
| 1b | `bloque_entrepiso` de cabecera opcional | Opcional (derivado) | **Opcional (Ronda 9)** | — | rápido | **✅ cerrado R9** |
| 1c | Snapshot de clima automático en el parte | No | Sí | — (web adelante) | — | n/a |
| 1d | Set de campos (personal/restricciones/equipos/clima/mín. fotos) | Completo | Completo | No | — | ok |
| 2a | Borradores multi-instancia persistentes | IndexedDB (Dexie) + fotos | **localStorage multi-borrador (Ronda 9, bitácora)** | Parcial | requiere decisión | **🟡 parcial R9** |
| 2b | Autosave en `visibilitychange`/`pagehide` | Sí | valueChanges + `pagehide` (bitácora) | Parcial | mediano | 🟡 parcial R9 |
| 2c | Hub "Documentación en proceso" (borradores + outbox) | Sí | Sección "En proceso" en bitácora | Parcial | mediano | 🟡 parcial R9 |
| 2d | Retomar-incompleto en forms no-bitácora | 14 forms | No | Sí | mediano | backlog |
| 3a | Captura de checklist pre-uso | Sí (offline) | Solo visor/registro (Ronda 6 paridad) | Parcial | mediano | backlog |
| 3b | Captura de combustible | Sí | Dashboards + registro web | Parcial | mediano | backlog |
| 3c | Entrega/recepción de vehículo | Sí | **Sí (W3/Ronda 8 `registrar-entrega`)** | — | — | ok |
| 3d | Captura de multa | Sí | **Sí (T12 + detalle W5)** | — | — | ok |
| 3e | Accidente/daño de vehículo | Sí | **Sí + fotos del hecho (X3/Ronda 9)** | — | — | ok |
| 3f | Reporte de mantenimiento | Sí | **Sí (con tipos X6/Ronda 9)** | — | — | ok |
| 3g | Conteo de inventario con stock en vivo | Sí (diff, offline) | **Solo lista, sin form de conteo** | Sí | mediano | backlog |
| 3h | Entrada/salida de inventario multi-línea | Sí (offline, drafted) | Vistas admin + registro | Parcial | mediano | backlog |
| 3i | Captura offline-first (outbox) | Sí, todos los flujos | No (RPC online) | Sí | requiere decisión | backlog (fuera de alcance web) |
| 4a | Personal de obra: registrar + expediente (datos, carnet/QR, fotos, **documentos y contratos firmados**) | Sí (wizard AZ + visor PDF de contratos, BF8/FASE 4) | **Sí (BF8)** — mismo hogar Proyectos › Personal; RRHH gana el submódulo `proyectos.personal` | — | mediano | **✅ cerrado BF** |
| 4b | Requisición corregible tras creada (obra/ubicación editable + rechazada → corregir → **reenviar** v2 con historial) | **Sí (BF6)** — obra editable, motivo del rechazo visible, diff en historial | **Sí (BF6)** | — | mediano | **✅ cerrado BF** |
| 4c | Proveedor con **tipos** (ferretería/suministros/transportista/otro) + alta al vuelo | Sí (transportista desde conduce externo, estampado server-side) | **Sí (BF2)** — maestro unificado `sgc.proveedores` con `tipos[]` | — | requiere decisión | **✅ cerrado BF** |
| 4d | Preferencias de avisos por usuario (silenciar informativos; operativos no) | Sí (Perfil → Preferencias de avisos; silencia el **push** server-side, BF4) | **Sí (BF4)** — silenciado por usuario + reglas de admin por rol/global | — | rápido | **✅ cerrado BF** |
| 5a | **Crear conduce** (origen→destino→artículos→despachante→chofer/vehículo→receptor→foto→emisión) | Sí (wizard táctil AU14) | **Sí (BJ3)** — `/inventario/salidas` con despachante + chofer/vehículo (auto-ruta BH3) + foto obligatoria; gate por `puede_crear_conduce()` (incluye chofer) | — | mediano | **✅ cerrado BJ3** — ⚠️ detrás del flag `conduce_wizard_web_habilitado` (=true); retirar el gate cuando esté verificado en prod |
| 5b | Borradores de conduce (AE9) | Sí | No | Sí | mediano | backlog (menor) |

## Árbol de Ingeniería (BH2 — 02/09/2026)

| # | Capacidad | App | Web | Gap | Clase | Estado |
|---|---|---|---|---|---|---|
| BH2 | **Árbol de Ingeniería** (menú del módulo) | **1 tile** (Solicitud de movimiento) + capacidad dispersa en hubs sueltos (`/bitacora`, `/obra`, `/solicitudes`, `/transporte/por-confirmar`) | **13 hijos** bajo el grupo paraguas del sidebar (`shell.ts`) | **Organización, no capacidad** — la app tiene casi todo, en hubs separados. 2 huecos reales: **Dashboard de bitácora** y **Mi proyecto** no existen en la app | requiere decisión (cerrada) | **✅ decidido BH2** — árbol canónico aprobado (ver `docs/AV5-AV6-…` §AV6 CERRADO). Ejecución app = **traslado puro con mock-first** en **PROMPT-31**; web ya es canónica |

Árbol canónico (capacidades, web=app): `Requisición · Solicitud de movimiento · Confirmar entregas · Bitácora (suite) · Producción de obra (Plan del día · Avance · No conformidades · Checklists · Subcontratistas) · Informe semanal de obra · Mi proyecto · Dashboard de bitácora`. **"Crear ruta"** vive en Flota (no en Ingeniería). El **traslado** de los tiles de uso diario del home de la app al hub va **con mock validado primero** (lección BD1).

## Decisiones de arquitectura (Ronda BF — 01/09/2026)

- **Selector de obras POR CONTEXTO (BF7):** `directorio_proyectos(p_contexto)` es **WIDE** por defecto (conduce/ruta/personal/despacho → todas las obras activas para todos, incluido el chofer) y `proyectos_pickables()` es **SCOPED** (requisición/compra/bitácora → el ingeniero ve las suyas + red AW1). Arregla el "chofer no ve obras" sin barrer al ingeniero.
- **Proveedores unificados (BF2):** un solo maestro `sgc.proveedores` con `tipos text[]` (ferreteria/suministros/transportista/otro, multiselección); `is_hardware_store` queda sincronizado con `'ferreteria'`. El alta al vuelo del conduce externo nace `transportista`.
- **Requisición corregible (BF6):** `motivo_rechazo` es columna propia (deja de pisar `notas`); `editar_requisicion` pasa a 5-arg (`+p_proyecto_id`, editable en `pendiente` **y** `rechazada`; una rechazada vuelve a `pendiente` v2 con el diff en el historial que el aprobador ve antes de aprobar).
- **Avisos (BF4):** `send_push` respeta `notif_pref_usuario` (silencio del usuario) **y** `notif_regla` (reglas de admin por rol/global) a nivel de servidor; cada envío deja traza en `notif_entregas` (enviada/entregada/fallida/omitida + motivo), visible en Administración.

## Decisiones de arquitectura (Ronda 9)

- **Multi-bloque bitácora (1a):** se re-modeló la captura de actividades de la web
  de un mapa `estructura|actividad` a un **arreglo de renglones** con clave
  `(bloque · estructura · actividad)` — la misma actividad puede registrarse en dos
  bloques en el mismo parte. `bloque_entrepiso` de cabecera pasó a **opcional** y
  actúa solo como default. El RPC (`crear_entrada_bitacora`) y el esquema **no
  cambiaron** (ya guardaban `bloque` por actividad).
- **Borradores web (2):** en vez de replicar el IndexedDB+Dexie de la app (pesado
  para el back-office), la web usa **localStorage multi-borrador** (clave por
  instancia) con autosave (`valueChanges` + `pagehide`) y una lista "En proceso"
  para retomar/descartar. No persiste archivos (limitación aceptada: el back-office
  suele completar el parte en una sesión). El hub global de en-proceso y el
  retomar en otros forms quedan en backlog.

## Backlog (priorizar en próximas rondas)
- 2d — retomar-incompleto en forms largos no-bitácora (flota, inventario).
- 3a/3b/3g/3h — formularios de captura web para pre-uso, combustible y **conteo de
  inventario con stock en vivo** (hoy la web solo lista los conteos).
- 3i — captura offline-first en la web (requiere decisión; el back-office suele
  tener conexión, así que baja prioridad).

## PROMPT-48 (BP) — contratos para la app (PROMPT-49)

- **BP4 — daños en bitácora (`guardar_bitacora_extra`).** La web crea la bitácora con
  su RPC de siempre y luego llama **`guardar_bitacora_extra(p_bitacora_id, p_extra jsonb)`**
  (SECURITY DEFINER, idempotente por bitácora). Contrato de `p_extra`:
  ```json
  { "danos": [ {
      "tipo": "material" | "equipo_propio",
      "articulo_id": "uuid|null", "nombre_libre": "texto",
      "cantidad": 0, "unidad": "ud", "unidad_capturada": "atado|null", "factor_aplicado": null,
      "detalle": "qué pasó", "fotos_paths": ["path1","path2"],
      "solicita_retiro": false
  } ] }
  ```
  `tipo='material'` + `solicita_retiro=true` (requiere ≥1 foto) crea el retiro BG4 idempotente
  (`client_id = md5(bitacora_id:idx)`) y aparece en `/inventario/retiros`. `equipo_propio` no crea
  retiro (no existe `equipo_obra`; se captura por texto). La app implementa el paso en PROMPT-49 F2:
  sube las fotos del daño al bucket `sgc-bitacora` (subpath `.../danos/`) y manda sus paths.
- **BP5 — Dev notes.** La app: **solo lectura** en esta tanda (lista + preview markdown,
  `csd-app/pages/tecnologia/`, filtra `ambito='dev'`, gate `es_tecnologia`). Escribir desde el móvil
  queda para más adelante. El cuerpo se renderiza con `marked` + sanitizado.
- **BO9 / BQ8 — moldes (contrato para PROMPT-51 F4).** Mismo `p_extra` de arriba, clave `"moldes"`; el
  RPC `guardar_bitacora_extra(p_bitacora_id, p_extra)` ya itera por tramo (sin cambio de DB).
  - **`molde-esquema` v2** (`src/shared/ui/molde-esquema/`) — se copia **verbatim** a `csd-app`. API
    estable: `forma: input<string>('rectangular')` (`rectangular|L|T|U|circular|libre`),
    `tramos: input<MoldeTramo[]>([])`, `medidaPlano: input<MoldeTramo[]|null>(null)`,
    `toleranciaCm: input<number>(2)`. `MoldeTramo = { lado?: string; largo_cm?; alto_cm?; espesor_cm? }`
    (cm nullable). Dibuja por `forma`: rectangular con las 3 cotas, L/T/U como polígono de 2-3 tramos
    (cota + plano punteado + rojo por lado fuera de tolerancia), circular (`largo_cm`=diámetro). Si
    `tramos.length>1` en cualquier forma, compone.
  - **`molde-compositor`** (`src/shared/ui/molde-compositor/`, BQ8b/c) — SVG + pointer events, sin
    librería (misma base que el pad de firma, snap a rejilla de 5 cm, teclado = flechas 5 cm, targets
    ≥56 px móvil). API: `valorInicial: input<CompositorFigura[]>([])`, `toleranciaCm: input<number>(2)`,
    `cambio: output<CompositorFigura[]>()`. `CompositorFigura = { id; tipo:'rect'|'L'|'T'|'U'|'circle';
    x; y; rot:0|90|180|270; largo_cm; alto_cm; espesor_cm; plano_largo_cm?; plano_alto_cm?;
    plano_espesor_cm? }` — **el mismo JSON que la ficha**; `molde-esquema` lo pinta. Nada de imágenes:
    datos. Modo alterno en "Moldes del día"; el borrador local guarda modo + figuras.
- **BQ2 — destinatarios de notificación (contrato de servidor).** Predicado único
  `sgc.destinatarios_notificacion(p_tipo, p_modulo, p_usuarios uuid[], p_canal)` → `(usuario_id, email,
  nombre, excluido_por)`: base por módulo o lista explícita, **resta** `notif_regla` (siempre) y
  `notif_pref_usuario` (salvo tipos `es_operativa`=críticos, §F-1); devuelve **también los excluidos**
  con `excluido_por ∈ {pref_usuario, regla_rol, regla_global}`. Las 6 edges de correo
  (`notificar-{flota,solicitud,entrega,incidente,soporte,cronograma}`) lo llaman y sólo mandan a los no
  excluidos, trazando a `notif_entregas`. La app, al añadir cualquier correo/aviso propio, **usa este
  predicado** — no copia la lista por módulo (regla 14). El path in-app/push sigue por
  `notificar_modulo`/`send_push` (no rerouteado, evita regresión); BQ4 añadió
  `notificar_usuarios(uuid[],…)` para avisar a una lista explícita (encargado de bodega).

---

## Ronda BT (PROMPT-56, 17/09/2026) — contratos web↔app

- **§ avatar (BT3/#42, regla AU1) — columna y bucket ÚNICOS.** La foto de perfil vive en
  `usuarios.avatar_path` (una sola columna; **no** existe `foto_url`) y en el bucket **`sgc-avatars`
  (PÚBLICO)**. La URL se arma con `storage.from('sgc-avatars').getPublicUrl(path)` — **no** hay URL
  firmada ni TTL (bucket público → simple y estable; corrige la suposición del CONTEXTO). Escritura:
  RPC `actualizar_mi_avatar(p_path)` + subida comprimida (`comprimirImagen(file,'avatar')`, 512 px).
  **Fallback obligatorio:** `<img (error)>` → inicial del usuario (nunca un logo genérico). App
  (PROMPT-57 F2): leer la MISMA columna y bucket, misma `getPublicUrl`, mismo `onerror`→inicial; el
  bug del "logo SD" era construir mal la URL de un bucket público. Subir en una plataforma se ve en la
  otra en <1 min (el path es la fuente de verdad).
- **§ errores (BT7/#46, regla 9+16) — clasificación NEGOCIO vs SISTEMA compartida.** El SQLSTATE es el
  contrato: `22023`/`P0001` **con** `detail.campo` → **negocio** ("Revisar dato: <campo>", corregible);
  `23xxx`/`42xxx`/`53xxx`/`57xxx`/`08xxx` → **sistema** ("Con problema al enviar. Ya se reportó." +
  `report_app_error`). Web: `friendly-error.util.clasificarError()` + `humanizeError()`; el `mensaje` crudo
  NUNCA se pinta (`conduce-externo-form`, `conduce` detalle). App (PROMPT-57 F0): `outbox-detalle`/`pendientes`
  pasan el `mensaje` por `humanizeError`; el SQLSTATE crudo solo en `🩺 Código` (`esDesarrollador()`).
- **§ conduce externo — "quién transporta" (BT7).** El proveedor de transporte es un `sgc.proveedores`
  con `tipos @> {transportista}` (la tabla `proveedores_transporte` quedó RETIRADA/vacía; las FK se
  re-apuntaron a `proveedores` en BT7). La persona/«Otro» va por `transporta_texto` (texto libre) — no hay
  columna de persona. `crear_conduce_externo` valida el proveedor y devuelve `22023` (negocio) si no existe;
  la app debe **refrescar el catálogo** antes de enviar y separar persona (texto) de empresa (proveedor).
- **§ requisición cero (BT8/#48) — contrato RPC.** `aprobar_requisicion` ya **acepta renglones con
  cantidad 0** (los salta, no toca `detalle_salidas`, mantiene el pendiente). La app (`generar-conduce
  ?requisicion=`, PROMPT-57 F3): 0 = "no se despacha ahora"; error solo si TODOS son 0; la X quita el
  renglón (con confirmación), distinto de 0.
- **§ preferencias — `mis_preferencias().notif` (BT6/#45).** `mis_preferencias()` devuelve, además de idioma/tema,
  `notif: [{tipo, activa, silenciable}]` — `silenciable` = el usuario puede apagar esa alarma operativa
  (por `notif_tipo.silenciable_por`/`silenciable_por_roles`). App (PROMPT-57 F4): en *Preferencias de
  avisos*, las alarmas semanales muestran switch si `silenciable`, "Siempre activa" si no.
- **§ i18n-coverage (BT2/#41) — mismo script y umbrales.** `scripts/i18n-coverage.mjs` + `src/app/core/i18n/alcance.json`
  (pantallas del alcance) + `scripts/i18n-whitelist.json` (nombres propios) se copian **del padre al hijo**.
  Umbrales: `en` se ofrece al ≥95 % de las pantallas del alcance, `ht` al ≥90 % (si no, "próximamente"
  deshabilitado). La unidad de cobertura es la **pantalla**, no la clave (regla 17).

## Ronda BS (PROMPT-54, 17/09/2026) — contratos web↔app

- **⭐ i18n portada del HIJO — 1ª vez que csd-app es la referencia de infraestructura.** El sistema i18n
  runtime (sin `@angular/localize`) nació en la app: la web portó `i18n.service.ts`, `translate.pipe.ts`,
  `language-selector` y `verify-i18n.mjs` **del hijo** (adaptación: `localStorage` en vez de Capacitor
  Preferences). **Las CLAVES de traducción SON el texto en español** (es no necesita catálogo); `en`/`ht` son
  superposiciones (`public/i18n/*.json`). Al tocar cualquier pantalla, pásala por `t()` (regla en CLAUDE.md).
- **Idioma canónico = `usuarios.idioma`** (BR7, compartido). Web y app escriben vía `mi_idioma_set(p_idioma)`
  y lo adoptan al cargar el perfil (`adoptFromServer`). **NO se duplica** en `usuario_preferencias`:
  `mis_preferencias()` lo coalesca desde `usuarios.idioma`; `set_mi_preferencia('idioma',…)` escribe ambos.
- **`usuario_preferencias` (BS3) — misma tabla para web y app.** RPCs `mis_preferencias()` / `set_mi_preferencia(clave,valor)`
  (whitelist: idioma|tema|densidad|tamano_letra|modulo_inicio). RLS: solo el propio usuario. App (PROMPT-55 F2):
  Perfil ⚙ lee/escribe esta tabla (idioma, tema) — no inventa columnas nuevas.
- **Diálogo de primer ingreso de idioma (BS4/#39) — en AMBAS plataformas.** Web ya lo tiene
  (`shared/ui/language-onboarding`, sella `idioma_elegido_at` vía `set_mi_preferencia`). App (PROMPT-55): al
  primer login, si `idioma_elegido_at` es null, muestra el mismo modal; al elegir, **nunca vuelve a salir** (ni
  cross-device, ni en la otra plataforma) porque el sello es canónico.
- **Notificaciones i18n v1 (BS4).** `notif_tipo.titulo_i18n jsonb` + `notificar_modulo` localiza el **título
  in-app por destinatario** (`usuarios.idioma`). Cuerpo y push en español (v1). App: sin cambio (recibe el
  título ya localizado).
- **Picker de almacén (BS1) — contrato para `generar-conduce` (PROMPT-55 F3):** el selector de almacén debe
  ofrecer **todos** los almacenes que el rol lee (nunca solo el de la obra), con **Central primero** por
  conveniencia y la cobertura n/N por opción. La conveniencia es el preseleccionado, no el filtro (regla 16).

## Ronda BR (PROMPT-52, 15/09/2026) — contratos web↔app

- **`registrar_combustible_app` (v-acepta, BR1/BQ7):** ya NO rechaza al chofer por salto de km ni por no
  estar asignado. Acepta con banderas `km_alerta` / `sin_asignacion` (columnas nuevas en
  `registros_combustible`) y avisa a Flota. Devuelve además `sin_asignacion` y `aviso` (texto "Logística
  lo revisará"). Rechazo duro solo para galones > tanque / precio fuera de banda; un `es_flota_elevado()`
  con `p_confirmado=true` los pasa. App (PROMPT-53 F1): la tarjeta de pendientes debe ofrecer *Descartar*
  y *Avisar a Logística*; el salto ya no da error.
- **`vehiculo_set_km_base_combustible(uuid, integer, text)` (BR1, admin):** fija `vehiculos.km_base_combustible`;
  el salto se mide desde `greatest(max(kilometraje), km_base_combustible)`. Solo `is_admin()`.
- **`responsable_id` (BR2):** `salidas_inventario.responsable_id → usuarios`. `registrar_salida_inventario` y
  `aprobar_requisicion` aceptan `p_responsable_id uuid default null` (rellenan el texto `responsable` con
  `usuarios.nombre`). App: al emitir conduce, mandar `responsable_id` (el texto queda como snapshot).
- **Transferir conduce (BR3):** el mismo RPC de la app — `ofrecer_transferencia_conduce(salida_id,
  conductor_id, notas)` → el receptor acepta con `aceptar_transferencia_conduce` (foto+firma). Gate
  ampliado a `es_flota_elevado() or tiene_modulo('inventario') or titular`. Web permite **asignar** aunque
  el conduce no tenga chofer aún.
- **`rechazar_recepcion(p_tipo text, p_id uuid, p_motivo text, p_foto_path text)` (BR4):** `tipo`
  `entrada|salida`. Motivo obligatorio (22023). No mueve stock. Estado `rechazada` (salidas) /
  `rechazada=true` + `pendiente_confirmacion=false` (entradas). Notifica al emisor `recepcion_rechazada`.
  App (PROMPT-53 F4): botón Rechazar junto a Confirmar; entradas con 0 renglones no se crean.
- **Conduce externo ↔ requisición (BR5):** `crear_conduce_externo(..., p_origen_requisicion_id uuid)` ya
  existe y setea `conduces_externos.origen_requisicion_id`; `requisicion_avance` lo cuenta al confirmarse
  la compra. Web: botón "Comprar en ferretería" en la requisición prellena y enlaza.
- **Cartillas (BO10):** contrato para la app (PROMPT-53 F5): `crear_cartilla(p_id uuid, p_proyecto_id uuid,
  p_fecha date, p_atados jsonb, p_fotos jsonb, p_plano_path text, p_notas text)` idempotente por `p_id`.
  `p_atados` = `[{identificador, elemento, cantidad_piezas, piezas:[{marca, diametro_codigo, figura_codigo,
  tramos_cm:[{lado,cm}], cantidad}]}]`. Valida diámetro/figura contra `acero_diametros`/`cartilla_figuras`;
  calcula `peso_kg`. Estados `borrador→enviada→revisada|observada→ejecutada` vía
  `cartilla_cambiar_estado(p_id, p_estado, p_nota)`. Fotos → `cartilla_fotos` (bucket `sgc-cartillas`).
  Fecha elegible (BL9). Detalle: `cartilla_detalle(p_id)`.
- **`user-picker`** (`shared/ui/user-picker`): selecciona un usuario del directorio (búsqueda por
  nombre/rol) o texto libre ("Otro"); emite `{usuario_id, nombre}`. Reusado por responsable (BR2) y
  transferir (BR3).

## Ronda BV (PROMPT-60 web) → contratos para la app (PROMPT-61)
- **Vehículo `nombre · placa` (BV2):** `sgc.vehiculo_display(uuid)` = `coalesce(alias, marca modelo año) · placa`;
  `vehiculos.alias` editable. Regla: **un vehículo se muestra SIEMPRE `nombre · placa`**, nunca solo la placa
  (resúmenes, selects, tablas de Flota, app).
- **Requisición con fase (BV9/10/11):** columna computada `requisicion_fase(uuid)` →
  `pendiente|en_proceso|completada|rechazada` (NO tocar el CHECK de `estado`). La app lista por fase (pestañas
  con conteo), ordena por `fecha_necesidad` ascendente (sin fecha al final) y permite editar la fecha con
  `requisicion_set_fecha_necesidad(p_id, p_fecha, p_motivo)` (gate solicitante mientras pendiente/en_proceso,
  o flota-elevado/inventario; historial + aviso `requisicion_fecha_cambio`).
- **Cobertura de requisición (BV4):** al confirmar recepción de una salida NO ligada, el hook
  `trg_vincular_requisiciones_al_recibir` corre `vincular_movimiento_requisiciones('salida', id[, p_solo_articulo])`
  (catálogo score 1; nombre trigram ≥0.6 con `revisar` <0.8; idempotente; salta `origen_requisicion_id`).
  Pendiente = coverage-aware; `requisicion_fase` cierra a completada al llegar a 0. Ver/deshacer:
  `requisicion_cobertura(p_id)` / `desvincular_cobertura(p_id)`. Kill-switch `flota_config.vincular_requisiciones=0`.
- **Conduce externo con inventario (BV6):** `crear_conduce_externo(..., p_items jsonb)`: si el ORIGEN es
  almacén nuestro → salida (baja stock al emitir); si el DESTINO lo es → entrada **pendiente**
  (`pendiente_confirmacion` + `items_propuestos`, sin stock). `conduce_externo_confirmar_receptor` materializa
  la entrada (sube stock) y marca la salida recibida (dispara BV4). `origen_tipo`='otro'. Anular borra la
  entrada si seguía pendiente. Chip AFECTA INVENTARIO.
- **Asignar chofer a conduce (BV7):** `asignar_chofer_conduce(p_salida_id, p_conductor_id, p_vehiculo_id)`
  (gate logística/flota/admin, valida chofer activo; dispara `tg_conduce_autoruta`). La app puede asignar desde
  "Por despachar" (uno o varios). Choferes: `choferes_activos()`.
- **Pendientes del almacén (BV3):** `bodega_pendientes(p_bodega_id)` → filas `{tipo 'entrada'|'salida', id, fecha,
  referencia, renglones, dias}` (entradas por confirmar + salidas despachadas sin recibir). La app las muestra al
  abrir un almacén.
- **Materiales a cargo del ingeniero (BV8):** `materiales_a_cargo(p_usuario_id)` → `{proyecto_id, proyecto,
  articulo_id, articulo, unidad, cantidad}` (recibido − devuelto en sus obras; ver el de otro exige admin/dirección).
  App: pestaña "A mi cargo" / en el perfil del ingeniero.
- **Echada retroactiva con permiso (BV1):** `registrar_combustible_app(..., p_fecha)` rechaza fecha futura y,
  si la fecha es pasada, exige `puede_registrar_combustible_retro(uid, fecha)` (permiso vigente o flota-elevado/
  admin). Otorgar/revocar/listar: `otorgar_permiso_combustible_retro(p_usuario, p_dias_max, p_vence, p_motivo)` /
  `revocar_permiso_combustible_retro(p_id)` / `permisos_combustible_retro_listar()`. La echada queda
  `retroactiva=true` + `permiso_id`; avisos `combustible_retro_permitida` (al chofer) / `combustible_retro_usada`
  (a flota). App: pantalla "Nueva echada" con borrador recuperable (BV5) + fecha bloqueada salvo permiso.
- **Echada recuperable (BV5):** la pantalla de nueva echada autoguarda un borrador local; si se cierra/crashea,
  ofrece Retomar (datos de texto; fotos se re-toman) o Descartar; se limpia al registrar.

## Ronda BW (PROMPT-62 web) → contratos para la app (PROMPT-63)

### § Material no catalogado (BW2)
- **Bug (web):** el `app-articulo-picker` es **controlado** (pinta lo elegido desde su input
  `[value]`, solo emite `selectionChange`). El modal *Vincular a un artículo* / *Declinar → ya existe*
  no pasaba `[value]` → el usuario elegía y el select seguía en «Selecciona un artículo…» (lo que
  reportó Felix con *Ties 20CM*). **Arreglado:** `[value]="vincularArticuloId()"` /
  `[value]="declinarArticuloId()"`; el botón dice *«Vincular a <artículo>»* (AT11) y se deshabilita sin
  selección. **Lint permanente** en `verify-regresiones.mjs`: todo `<app-articulo-picker>` (evento
  `selectionChange`), `<app-user-picker>` (`selected`) y `<app-filter-select>` (`valueChange`/`valuesChange`)
  **debe** enlazar su valor (`[value]` / `[values]`); un picker de "agregar" que resetea usa `[value]="null"`.
- **RPCs (nombres reales — la app los llama igual):**
  - `sgc.vincular_item_libre_articulo(p_item_libre_id uuid, p_articulo_id uuid, p_generar_movimiento boolean)`
    → vincula el material libre a un artículo existente. `p_generar_movimiento` (AY13) registra además la
    salida real desde la bodega de origen del conduce (baja stock); si se deja `false`, solo vincula.
  - `sgc.crear_articulo_desde_libre(p_item_libre_id uuid, p_nombre text, p_categoria_id int, p_unidad text, p_generar_movimiento boolean)`
    → **atómico**: crea el artículo (código `CSD-NN-###` autogenerado, triggers de apertura aplican el piso),
    lo vincula y opcionalmente genera el movimiento. Devuelve `{ id, codigo }`. (No existe
    `crear_articulo_desde_libre` previo; se creó en esta ronda. La web dejó de hacer create+vincular en 2 pasos.)
- **Gate (ambos RPCs):** `es_flota_elevado() OR tiene_modulo('inventario')` — antes era
  `is_admin() OR inventario`, dejaba fuera a Raykler/logística. **No** se ensanchó `puede_gestionar_articulos()`
  (editar/borrar/stock del catálogo siguen admin/inventario). Web: `puedeGestionar = esFlotaElevado() || hasModulo('inventario')`.
- **App (PROMPT-63 F1):** `material-no-catalogado` de la app hoy es solo lectura + *declinar*
  («Crea el artículo desde la web SGC…»). Gana **Vincular a un artículo** (picker de la app, offline:
  outbox `tipo_op:'vincular_item_libre'`) y **Crear artículo** (llama `crear_articulo_desde_libre`), ambos con
  el switch *Generar movimiento de inventario* (AY13). Visibles para `es_flota_elevado()`/inventario.

### § BZ (25/09/2026) — detalle de echada, pendiente único, bitácoras y requisiciones (PROMPT-69)
- **`sgc.echada_detalle(p_id uuid) returns jsonb`** — camino ÚNICO del detalle de una echada
  (web `getById` + app). SECURITY DEFINER, gate `es_flota_elevado() or is_admin() or dueño`
  (chofer del `conductor_id` o `registrado_por`). Devuelve la fila + `vehiculo{placa,marca}` +
  `conductor{nombre}` + `registrador{nombre}` + `revisor{nombre}` + `vehiculo_display` +
  `motivo_revision` + `historial[]` (con `editor.nombre`, listo para humanizar, BX2). Reemplaza el
  `.from('registros_combustible')` con embeds que fallaba para quien lista por RPC pero no pasa la RLS
  de la tabla. **La app usa el mismo RPC en el detalle de la echada** (nota #77). Lint
  `verify-regresiones`: `.from('registros_combustible')` solo en `combustible.service.ts` /
  `combustible-conciliacion.service.ts`.
- **`sgc.item_libre_pendiente(il sgc.salida_items_libres) returns boolean`** = `articulo_vinculado_id is null
  AND declinado_at is null`. Predicado ÚNICO de "material no catalogado pendiente"; lo usan
  `conduces_por_implementar()/_count()`, `material_no_catalogado_pendientes()/_count()` y el hook BV4.
  La app debe usarlo (no el predicado inline) al contar/mostrar pendientes (nota #78). Lint permanente
  contra `articulo_vinculado_id is null` fuera de esa función.
  - `material_no_catalogado_pendientes(p_incluir_resueltos boolean, p_salida_id uuid)` — nuevo 2º arg:
    filtra por conduce (desde "Implementar") e incluye resueltos/declinados para ver qué pasó.
  - Gate de lectura de la bandeja alineado: `is_admin() or inventario or flota or es_flota_elevado()`
    (antes solo inventario → a Raykler le salía vacía). `declinar`/`revertir` ahora `es_flota_elevado() or inventario`.
- **`sgc.listar_bitacoras(p_todas boolean, p_proyecto uuid, p_desde date, p_hasta date, p_ingeniero uuid)`**
  (BY4) — contrato de lista para la app con la RLS de bitácora (`puede_ver_bitacora_de`). `p_todas=false`
  → solo las mías; `true` → todas las visibles.
- **`sgc.reenviar_echada(p_original uuid, p_datos jsonb)`** — idempotente por `(reenvio_de, client_uuid)`:
  la app debe mandar `p_datos.client_uuid` estable; un reintento devuelve el reenvío ya creado (BY5).
- **`sgc.requisiciones_bandeja(...)`** — ahora expone `cerrada_en` en la lista (la app arma el Historial, BY3).

## Ronda CA (27/09/2026) — contratos para la app (PROMPT-71)

### CA2 — Visibilidad de obras unificada (`mis_proyectos`)
- **`sgc.mis_proyectos(p_usuario uuid default null, p_todos boolean default null)`** — mismo predicado
  que la RLS de `proyectos` (`sgc.puede_ver_proyecto`). Cambios de contrato:
  - **Nueva firma de 2 args.** La app llama `mis_proyectos()` (sin args) → `p_todos=null` → devuelve
    **todo lo visible** (para un módulo-proyectos como Sócrates = todas las obras activas). Antes la
    firma de 1 arg devolvía solo las suyas → la app mostraba vacío (bug CA2).
  - `p_todos=false` → **solo las suyas** (responsable/residente/empleado) → úsalo para el bloque
    **"Mis obras"**. `p_todos=null/true` → todas las visibles → el resto va a **"Otras obras"**.
  - **Cada fila trae `es_mia boolean`** (responsable/residente/empleado): con esto la app separa
    *Mis obras* (`es_mia=true`) de *Otras obras* (`es_mia=false`) sin una segunda llamada, y el picker
    de bitácora/conduce/OT prioriza *Mis obras*.
  - `es_prueba` sigue solo admin. La red AW1 ("sin obra ligada → ve todas") aplica igual que en la web.
- Nota: un chofer puro (sin obra ligada) también verá todas bajo *Otras obras* (red AW1, paridad con web).

### CA1 — Alarmas de vehículo solo a operativos + pref fijada por admin
- **`sgc.es_usuario_operativo_flota(p_usuario uuid default auth.uid())`** — la app puede usarla como
  cinturón: antes de disparar la **alarma nativa** (`data.tipo='alarm-weekly-inspection'`), verifica la
  pref y/o que el usuario sea operativo; si no, **no dispares** y **cancela** cualquier alarma local
  programada. Un Gerente/Ingeniero con ficha suelta ya no es "chofer".
- **`sgc.mis_notif_operativas()`** — cada tipo trae ahora `silenciada_por_admin boolean`. Muéstralo en
  Perfil › Notificaciones como *"Silenciada por Tecnología"* (AT11: dato enviado = dato visible). Si
  `activa=false`, la app no debe programar la alarma local de ese tipo.
- **`sgc.notif_permitida(u,tipo)`** ahora respeta el silencio fijado por un admin aunque el usuario no
  pueda silenciarse solo (columna "Silenciada para" de la Matriz, backing `notif_pref_usuario.definida_por`).

## Ronda CH (06/10/2026) — contratos para la app (PROMPT-85)

### CH1 — Validación de kilometraje (una sola regla, web = app)
- **`sgc.validar_km_vehiculo(p_vehiculo uuid, p_km numeric, p_fecha timestamptz, p_excluir_mant uuid default null)`**
  (DEFINER, gate `tiene_modulo('flota') or is_admin()`). Devuelve jsonb:
  `{ ok, nivel('ok'|'aviso'|'error'), unidad('km'|'h'), medida_uso, km_antes, fecha_antes, fuente_antes,
  km_despues, fecha_despues, fuente_despues, mensaje }`. La app debe **reemplazar** su bloqueo
  `km < odómetro` (rompía retroactivos válidos): llamar al RPC al cambiar vehículo/fecha/km y actuar por
  `nivel` — `error` bloquea Guardar (retroceso vs. lectura anterior, o exceso vs. lectura posterior),
  `aviso` pide confirmar (salto inverosímil), `ok` sin fricción. Usa `km_antes/fuente_antes/fecha_antes`
  como pista "Última lectura: X". Umbrales editables: `flota_config.km_dia_max` (800) / `horas_dia_max` (24).
- **Odómetro:** un trigger en `mantenimientos` (`tg_mant_avanzar_odometro`) ya avanza el odómetro al
  crear/editar (solo si el km es el más reciente; retroactivo no retrocede). La app no necesita avanzarlo
  aparte; `crear_mantenimiento_app` lo sigue llamando (idempotente).

### CH2 — Proveedor / Taller del maestro
- **`sgc.listar_proveedores_para_flota()`** (DEFINER, gate flota/admin/elevado/compras/inventario) →
  `table(id uuid, nombre text, tipos text[], es_taller boolean)`, solo activos, **talleres primero**.
  La app debe listar talleres/proveedores con este RPC (NO `select proveedores` directo: la RLS exige
  compras/inventario, que un chofer/flota no tiene). Agrupar Talleres / Otros proveedores + "Otro…".
- **`taller`** es un tipo válido de `proveedores.tipos` (multiselección; comment actualizado).
- **`crear_mantenimiento_app(..., p_costo, p_proveedor, p_notas, p_proveedor_id uuid default null)`** —
  canónica de **14-arg** = la versión rica que YA tenían dev y prod (13-arg: lógica AL7, tipos extendidos,
  aviso al jefe de flota) + `p_proveedor_id` al final (retrocompatible por default). **Regla 19:** se
  dropearon TODOS los overloads previos (10/12/13-arg) para dejar una sola función idéntica en ambos
  entornos. Guarda `proveedor_id` del maestro + copia el nombre a `proveedor` (historial/export). "Otro" =
  solo texto en `p_proveedor`, `p_proveedor_id = null`.

### CH3 — Tipo de documento por archivo
- **`sgc.mantenimiento_adjuntos.descripcion text`** (aditiva, nullable) — detalle libre cuando
  `tipo_documento = 'otro'`. La app ya elige el tipo por documento; añadir **editar el tipo** antes de
  guardar, la **inferencia** inicial (imagen→foto; PDF por nombre: fact/ncf→factura, cot→cotización,
  inf/reporte→informe; si no, factura) y **agrupar por tipo** en detalle/historial.

## CK (08/10/2026) — contratos para la app (PROMPT-91)

### CK6 — choferes para transferir/asignar
- La web dejó de usar `conductores_para_multa` para el picker de transferir/asignar conduce.
  Fuente única (web **y** app): **`sgc.choferes_activos()`** → `(conductor_id, nombre)`, mapeado a
  `{id: conductor_id, nombre}`. Validar UUID antes de llamar a `ofrecer_transferencia_conduce`/
  `asignar_chofer_conduce` (nunca mandar "undefined" a un uuid).

### CK8 — directorio con códigos de rol
- **`sgc.directorio_usuarios_detalle()`** ahora devuelve además **`roles_codigos text[]`** (códigos, no
  nombres). Filtrar por rol se hace por CÓDIGO (`chofer_privado`), con respaldo por nombre normalizado si
  el RPC es viejo. (Un campo nuevo; consumidores existentes intactos.)

### CK4 — "Entregar a" (receptor asignable después)
- **`sgc.conduce_asignar_receptor(p_salida_id uuid, p_usuario_id uuid, p_forzar boolean default false)`**
  (DEFINER): permiso `es_flota_elevado()` o creador; solo mientras no haya recepción confirmada ni
  anulación; receptor activo y confirmador válido de la obra (`receptores_disponibles`), o `p_forzar`
  solo elevados (fuera de obra, auditado en `conduce_receptor_cambios`); regla de alto valor (no
  auto-recepción); reemplazo avisa al anterior y al nuevo. `asignar_firma_pendiente` sigue para el alta.
  La app debe añadir el mismo bloque "Entregar a" (offline por outbox, idempotente).

### CK3 — origen de la foto de la echada
- **`registros_combustible.foto_origen`** `('camara'|'galeria')`, default `'camara'`.
- **`registrar_combustible_app(...)`** ahora acepta un trailing **`p_foto_origen text default 'camara'`**
  (22-arg; se dropeó la firma 21-arg para no dejar overload). La app pasa `'galeria'` cuando la echada
  usa la foto subida de galería (último recurso tras 2 fallos de cámara). `log_combustible` devuelve
  `foto_origen`. Retrocompatible: no mandarlo = `'camara'`.

### CK10 — notificaciones que suenan
- **Canal Android: constante única `avisos_csd_v2`** (debe coincidir con el canal creado por la app:
  `IMPORTANCE_HIGH`, sonido + vibración + `VISIBILITY_PUBLIC`; borrar el viejo `avisos_csd`). La edge
  `send-push` ya fija en todo push normal: `android.notification.channel_id='avisos_csd_v2'`,
  `notification_priority='PRIORITY_HIGH'`, `sound='default'`, `default_vibrate_timings`,
  `visibility='PUBLIC'`; iOS `apns.payload.aps.sound='default'` + `interruption-level='time-sensitive'`
  para mensajes y trabajos de chofer. Alarma (`alarma_inspeccion`) intacta, data-only. Retrocompatible
  con APKs sin el canal v2 (Android cae al por defecto).
- **"Probar notificación":** RPC **`sgc.probar_notificacion()`** (push a sí mismo, ignora la matriz) →
  `{dispositivos}`; leer el resultado con **`sgc.mis_notif_entregas(p_limite)`**. La app expone el botón
  en Perfil › Notificaciones. Diagnóstico admin: **`sgc.notif_entregas_de_usuario(p_usuario_id, p_limite)`**.

## Tanda CL (PROMPT-92 web → PROMPT-93 app) — 1.163.0

### CL6 — marcar conduce externo como prueba (solo admin)
- **`crear_conduce_externo(...)`** gana un trailing **`p_es_prueba boolean default false`** (ahora 20-arg;
  se dropeó la 19-arg para no dejar overload). No-admin + `true` → error *"Solo un administrador puede
  marcar datos de prueba."* Con `true` el conduce nace `es_prueba` y su salida/entrada salen `es_prueba`
  (el trigger de stock NO mueve existencias). La app añade el mismo interruptor en `transporte/conduce-externo`.
- **`registrar_salida_inventario(...)`** gana trailing **`p_es_prueba boolean default false`** (10-arg; se
  dropeó la 9-arg): un movimiento de prueba no valida existencia ni mueve stock.
- **`marcar_prueba_cascada('conduces_externos', id, valor)`** soporta ahora el conduce externo: revierte /
  re-aplica el stock de la salida/entrada enlazada (vía `marcar_movimiento_inventario_prueba`) + el viaje.
- **Fix:** `marcar_movimiento_inventario_prueba` ya NO pone `NULL` en `es_prueba_origen` (NOT NULL) al
  desmarcar (antes "volver a real" fallaba). La app que use ese RPC ya hereda el arreglo.

### CL2 — sistema de movimiento (paridad conceptual)
- La app replica en su repo: directivas `appStagger`/`appCountUp`/`appEstadoPulse` (o equivalentes),
  `MotionService.momento(tipo, datos)` + componente de momento mediano (0.8s, sin velo, haptics corta),
  y su registro `src/app/core/motion/catalogo-movimiento.ts` con los MISMOS campos (id, nombre, nivel,
  sistema='app', pantallas, duracionMs, curva, reducido, desdeVersion, previewKey, estado). Tipos de
  momento compartidos: entrada, salida, aprobado, firma, combustible, checklist, mantenimiento, mensaje,
  documento. **Sin celebración** en accidente/multa/rechazo/eliminar/error/retiro dañado.

### CL5 — catálogo de animaciones
- Tabla **`sgc.movimiento_catalogo`** (PK `sistema,id`; RLS lectura admin+tecnología; escritura service_role).
- La app sube SUS filas con su propio `scripts/data-fixes/…-cl5-movimiento-catalogo.mjs --env dev|prod`
  (`sistema='app'`), leyendo su registro. Se corre en cada release. La pantalla web `admin/animaciones`
  ya muestra las filas `app` como "vista de la app".

### CL3 — bienvenida (pendiente ambos lados)
- Flags por usuario (web `bienvenida_web_v1_vista`, app `bienvenida_app_v2_vista`) + RPC
  `marcar_bienvenida_vista(p_canal)`; existentes = vistos. Mismos pasos por rol (docs/BIENVENIDA.md).

## Tanda CO (PROMPT-98 web → PROMPT-99 app) — 1.189.0

### CO1 — `version_publicada` ahora acepta plataforma; mínima real por plataforma
- **`sgc.version_publicada(p_plataforma text default 'movil')`** (se dropeó la 0-arg para
  no dejar overload ambiguo). La app debe llamarla con su plataforma real:
  `p_plataforma: 'movil'` (Android) o **`p_plataforma: 'ios-pwa'`** (PWA instalada en iPhone,
  `navigator.standalone` o `matchMedia('(display-mode: standalone)')`).
- **Fallback automático:** si no existe ninguna fila `app_versiones` con esa plataforma
  exacta, el servidor cae a `'movil'` — cero regresión mientras Admin no haya creado una fila
  `ios-pwa` separada. El día que Tecnología publique una versión `ios-pwa` distinta (porque el
  arreglo del updater, PROMPT-99 F1, solo aplica a la PWA), `version_minima`/`version_publicada`
  empiezan a diferir de Android automáticamente.
- **La app también debe registrar sus instalaciones con `plataforma='ios-pwa'`** (vía
  `registrar_version`/`set_mi_plataforma`) en vez de `'movil'` para que
  `sgc.dispositivos_listado()` (Sistema › Versiones de la app, columna "Atascado") las cuente
  aparte de Android.
- Detalle completo de la causa (APK 2.44/2.45 + huecos del Service Worker de la PWA) en
  [`docs/ACTUALIZACIONES.md`](./docs/ACTUALIZACIONES.md).

### CO13 — Contratos ↔ "Generar Documento"
- **`contratos.documento_generado_id`** ya existía en prod como columna huérfana (sin FK, sin uso
  real) — ahora tiene FK a `documentos_generados(id)` (`on delete set null`) + `contratos.archivo_firmado_path`
  (bucket `sgc-legal`, mismo bucket que expediente-archivos, prefijo `contratos/<id>/…`).
- **`sgc.contrato_detalle(p_id)`** → `{contrato, proveedor, proyecto, documento}` (el documento trae
  `plantilla_categoria` para saber si es de tipo Contrato). **`sgc.documento_usado_en_contrato(p_documento_id)`**
  → `{id, codigo, titulo} | null`, para "Usado en contrato CTR-…" en el Historial.
- **Generación del PDF hoy: 100% en el navegador**, sin edge ni archivo PDF persistido —
  `documentos_generados.contenido_html_final` es HTML; `/documentos/ver/:id` lo imprime/exporta
  del lado del cliente. **No hay edge `generar-documento`** que la app pueda invocar — portar esto
  a la app requiere replicar el merge (`plantilla-merge.util.ts`, YA existe en csd-app) + un
  render-a-PDF nativo, o delegar a un WebView de la web. Documentado para que PROMPT-99 decida
  con esta información.
- **App — Legal y Documentos completos (tu respuesta: todo menos editar plantillas):**
  - Legal: Expedientes (lista + ficha con pestañas Resumen/Notas/Archivos/**Contratos** — esta
    última lista `sgc.contratos` filtrado por `proyecto_id` igual que la web) y Contratos (lista +
    ficha con `contrato_detalle` + los 3 caminos de creación).
  - Documentos: Generar (plantilla → formulario → HTML final, mismo merge de texto) + Historial
    (con el badge "Usado en contrato") + Plantillas **solo ver + vista previa + marcar la que se
    usa** — "Editar" debe decir "Edita esta plantilla en la web" (el editor TipTap es web-only).
  - Permisos = los mismos de la web (módulo `legal`). Sonia (abogada) ya tiene el rol para probar.

### CO12/CO14/CO18 — Plantillas: editor TipTap + listado + subida unificada
- **Sin cambios de servidor/esquema.** `plantillas_documento.contenido_html` sigue siendo HTML con
  `{{clave}}` — el editor nuevo (TipTap, `shared/ui/editor-plantilla`) solo cambia CÓMO se produce
  ese HTML en el navegador; el nodo `campo` serializa a `<span class="campo-chip" data-campo-key="x">{{x}}</span>`,
  que `camposDesdeHtml()` (regex `{{clave}}`) sigue detectando igual que antes. **La app no necesita
  tocar `plantilla-merge.util.ts`** — el merge final sigue siendo texto-reemplaza-`{{clave}}`.
- **`duplicarPlantilla`** (nuevo en el service web) es un simple `insert` con `origen:'usuario'` —
  no hay RPC nueva; la app puede implementar el mismo "Duplicar" con un insert equivalente si
  decide ofrecerlo (opcional, la app ya era solo-ver para plantillas).
- **Datos de ejemplo** viven en UN solo lugar: `VARIABLES_CONTRATO[].ejemplo` (modelo compartido
  conceptualmente; el hijo puede portar la misma tabla si quiere mostrar miniaturas con datos de
  ejemplo en su propia pantalla de "solo ver" plantillas).
- **CO13.7 — contrato para la app (Legal/Documentos):** la generación de PDF hoy es
  **100% en el navegador** (no hay edge `generar-documento`): `DomSanitizer` + merge de texto +
  impresión/descarga del lado del cliente (`documentos/generar`, `documentos/ver`). La app
  necesitaría: (a) portar `plantilla-merge.util.ts` (YA existe en csd-app) + un render-a-PDF nativo
  (librería móvil, ya que no hay edge que la app pueda invocar para esto), o (b) seguir
  delegando "generar" a abrir la web en un WebView. Documentado aquí para que PROMPT-99 F5-F6
  decida con esta información, no a ciegas.

### CO2 — Novedades a pantalla completa
- **`sgc.novedades_pendientes(p_plataforma text)`** (`'web'`|`'app'`) → `jsonb` con
  `tiene_pendientes, version_vista, versiones[] (máx 5, desc), total_versiones, hay_mas,
  arreglado_para_ti[]` (frases ya armadas en texto, no requiere ensamblado en el cliente).
  **`sgc.marcar_novedades_vistas(p_plataforma, p_version)`** marca vista (idempotente).
- **Gotcha real (verificado en prod):** el web **nunca** marca `app_versiones.publicada=true`
  — ese flag es solo del rollout por etapas de la app móvil (Admin › Versiones, filtrado a
  `plataforma='movil'`); cada deploy de Vercel YA es la versión vigente. La RPC NO filtra por
  `publicada` cuando `p_plataforma='web'` (si lo hiciera, Novedades saldría siempre vacía para
  la web). Para `'app'` (plataforma `movil`) sí se exige `publicada=true`, igual que
  `version_publicada()`.
- **Fuentes de "arreglado para ti"** (las únicas que existen en este repo): reportes de error
  con `resuelto_en_version` donde el usuario tuvo una ocurrencia (`app_error_reports.user_id`),
  consultas de Compa que el usuario hizo y ya se resolvieron, y outbox atascado suyo ya resuelto
  — comparado contra `publicada_at`/`created_at` de la versión que tenía vista. **No existe una
  tabla de "tickets de Soporte"** en este repo — esa fuente del prompt original se omitió (no
  hay de dónde leerla); si el hijo tiene su propio sistema de soporte, puede sumar esa fuente
  del lado de la app sin tocar el contrato de arriba.
- `app_versiones.cambios[].para` (uuid[]) es opcional y aditivo — hoy no hay UI para fijarlo
  retroactivamente (backlog); la RPC de arriba no lo usa (no filtra por `para`, es solo para que
  un admin anote "esto responde a X" a futuro).
- **App (PROMPT-99 F5):** misma pantalla completa, mismo contrato (`p_plataforma='app'`),
  después del login/splash y de la bienvenida CL3 del hijo.

### CO10/CO17 — Web Push real (VAPID) — servidor listo, cliente es PROMPT-99 F4
- **Llave pública VAPID** (no es secreta, puede ir al cliente/environment):
  `BHNqedpFDYkwzNiOG9s8ukSo6kJiQkYPdmgw0pKCX3YBuxVkdp66rMP6D4pCT1FyKlBBcdSeWETA3zm1JZ3hwFE`.
  La privada vive SOLO como secreto de Supabase (`VAPID_PRIVATE_KEY`, dev+pendiente prod) — nunca
  al repo ni al cliente.
- **`sgc.registrar_suscripcion_web(p_endpoint, p_p256dh, p_auth, p_plataforma, p_user_agent)`**
  — la app llama esto tras `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey:
  <llave pública arriba, decodificada de base64url a Uint8Array> })`. `p_plataforma` informativo
  (`'ios-pwa'`/`'android-pwa'`). Upsert por `endpoint` (reinstalar/resuscribir no duplica).
  **`sgc.baja_suscripcion_web(p_endpoint)`** al desactivar notificaciones a mano.
- **`send-push`** (edge) ahora manda por Web Push a TODAS las suscripciones activas del usuario,
  en paralelo a FCM (no requiere token FCM). Limpia solas las suscripciones que respondan
  404/410. El payload que le llega al Service Worker de la app: `{ title, body, url }` (`url` =
  `data.ruta` del aviso original, o `/`). El SW de Angular ya maneja `push` y `notificationclick`
  (abre `url`) — PROMPT-99 F4 solo necesita el flujo de suscripción + la cinta inteligente.
- **`sgc.push_web_resumen()`** — gateado `es_tecnologia()`, para el panel admin (ya consumido en
  Sistema › Versiones de la app).

### CO9 — Apoyo de transporte: quién canceló + reabrir
- **`apoyo_transporte_listado(...)`** (misma firma) gana 4 columnas al final del `TABLE`:
  `cancelada_por_nombre, cancelada_at, motivo_cancelacion, completada_por_nombre`. La app debe
  pintar "Cancelada por X · fecha · «motivo»" / "Completada por X" en la TARJETA del listado
  (antes solo salía en el detalle/línea de tiempo).
- **`apoyo_transporte_cambiar_estado(p_id, p_estado, p_nota, p_client_id)`** (misma firma): ahora
  acepta `p_estado='pendiente'` como destino válido, y permite a `es_referente_movimiento()`
  (transporte elevado/admin) pasar de `completada`/`cancelada` a **cualquier** estado válido
  — **siempre con `p_nota` obligatoria** (sin nota, sigue lanzando "El apoyo ya está X"). Queda
  en `apoyo_transporte_eventos` y avisa al solicitante igual que un cambio normal.
- La app debe añadir el mismo bloque "Cambiar estado" en `apoyo-transporte-detalle` para
  `es_referente_movimiento()`, visible solo cuando `estado ∈ {completada, cancelada}`.

### CO15/CO3/CO16 — `registrar_combustible_app` gana `p_numero_recibo` + anti-dup 120s
- **Firma viva: 22 args** (no 23 — la app ya mandaba `p_numero_recibo`, el último trailing arg
  nuevo). Orden completo: `p_client_uuid, p_vehiculo_id, p_conductor_id, p_fecha, p_kilometraje,
  p_galones, p_monto, p_estacion, p_foto_recibo_path, p_foto_tablero_path, p_notas,
  p_foto_bomba_path, p_producto, p_tarjeta, p_titular, p_titular_es_persona, p_subtipo, p_origen,
  p_proyecto_id, p_confirmado, p_foto_origen, p_numero_recibo text default null`.
- `p_numero_recibo` se normaliza a solo dígitos en el servidor (la app no necesita limpiarlo).
- **Nuevo campo de respuesta:** `duplicado: true` cuando (a) el recibo ya existe para ese
  vehículo (no invalidada), o (b) mismo vehículo/persona + galones + monto + usuario en <120s
  (anti-doble-toque, CO16). En ambos casos la RPC **no inserta** — devuelve la fila existente
  (con su `id` real) en vez de fallar o crear otra. La app debe tratar `duplicado:true` como
  éxito silencioso (ya está guardada), no como error.
- **CO16 — la app debe mover su propia bandera `submitting`/`busy` a la PRIMERA línea del
  método de envío**, antes de cualquier `await` (GPS, posible-duplicado, confirmaciones). La
  causa real de CO3 (4-5 echadas) y CO5 (3 conduces) fue exactamente este patrón en
  `combustible.ts:1176-1210` y `generar-conduce.ts:948-1090`. El servidor ya tiene la red de
  120s como respaldo, pero el arreglo de raíz es del cliente — portar el mismo patrón
  (`verify-envio-unico.mjs` existe solo en el padre; el hijo debe aplicar la misma regla a mano
  o portar un guard equivalente).

### CO16 — `registrar_salida_inventario` y `crear_conduce_externo` ganan el mismo anti-dup
- **Sin cambio de firma** en ninguna de las dos (ni `salidas_inventario` ni `conduces_externos`
  tienen `client_uuid`; el anti-dup es por CONTENIDO, no por id de operación).
- `registrar_salida_inventario`: mismo `creado_por` + `bodega_id` + `proyecto_id` + `motivo` +
  el mismo conjunto de renglones (`articulo_id:cantidad`, normalizado a `numeric(10,2)`) en
  <120s → devuelve el `id` de la salida ya creada (no crea otra, no mueve stock de nuevo).
- `crear_conduce_externo`: mismo `auth.uid()` + mismo `origen`/`destino` (texto) + misma
  `placa_foto_path` en <120s y sin `p_salida_id` (ese caso ya es idempotente por sí solo) →
  devuelve el `id` del conduce externo ya creado.
- La app (PROMPT-99 F2.4) debe asumir que un reintento de cualquiera de estos 3 flujos puede
  devolver el id de una fila que YA existía — no es un bug, es la red de seguridad.

### CO8 — Compras tecnológicas: cotización + flujo de aprobación
- **Tabla compartida**, cambio aditivo: `solicitudes_compra`/`solicitud_compra_items` siguen
  siendo las mismas del flujo normal de Compras (requisición → compra); el flujo nuevo
  (`categoria='tecnologia'`) solo usa los estados nuevos
  `borrador → esperando_aprobacion → aprobada|rechazada → comprada` y columnas nuevas
  (`aprobador_id`, `enviada_at`, `decidida_por`, `decidida_at`, `motivo_rechazo`,
  `solicitud_compra_items.precio_unitario`). El flujo viejo (`pendiente/convertida/rechazada`)
  queda intacto para filas históricas y para el módulo normal de Compras.
- **`crear_solicitud_compra_tec` ahora nace en `'borrador'`** (antes quedaba `'pendiente'` y se
  enviaba sola). La app debe mostrar el borrador como editable/sin enviar hasta que el usuario
  agregue una cotización y llame `compra_tec_enviar_aprobacion`.
- **Cotizaciones = tabla nueva `solicitud_compra_adjuntos`** (`id, solicitud_id, tipo
  cotizacion|factura|otro, proveedor, monto, path, nombre, elegida, subido_por, created_at`) +
  bucket privado nuevo `compras-cotizaciones` (PDF/imagen, 15 MB). Subida: `storage.upload` al
  bucket, luego `compra_tec_adjuntar_cotizacion(p_id, p_tipo, p_proveedor, p_monto, p_path,
  p_nombre)` — la primera cotización de una solicitud queda `elegida=true` automáticamente;
  `compra_tec_elegir_cotizacion(p_adjunto_id)` cambia cuál es la elegida. Lectura de archivo vía
  `storage.createSignedUrl` (política: solo solicitante, aprobador o `es_tecnologia()`).
- **RPCs del flujo** (todas `security definer`, graban auditoría vía columnas propias, no tabla
  aparte): `compra_tec_enviar_aprobacion(p_id)` fija `aprobador_id` = parámetro
  `compras_tec_aprobador` (hoy Eduardo Ng) y notifica; `compra_tec_decidir(p_id, p_aprobar,
  p_motivo)` exige `p_motivo` si `p_aprobar=false` (error `22023` si vacío) y notifica al
  solicitante; `compra_tec_marcar_comprada(p_id)` solo desde `'aprobada'`.
- **"Esperando a Eduardo"**: la app debe resolver el nombre del aprobador (embed
  `aprobador:usuarios!solicitudes_compra_aprobador_id_fkey(nombre)`) para mostrar "Esperando a
  {nombre}" en vez de solo el estado genérico — así lo pide el mock del padre.
- **Aprobar desde el teléfono** (punto 4 del prompt original): la app (PROMPT-99) necesita una
  pantalla mínima de "Compras tecnológicas por aprobar" para quien sea `aprobador_id` —
  lista + ficha con vista previa de la cotización + botones Aprobar/Rechazar (motivo
  obligatorio). No requiere pantalla de creación nueva en la app (eso ya existía).

## Tanda CM — cierre de huecos del padre (PROMPT-94/96 → app PROMPT-95/97)
> Aplicado **dev + prod** el 2026-10-12 (ledger + verificado por objeto). Desbloquea F3/F6 del app (2.48.0).

### CM6 (F3) — incentivos con tope: la lectura ya trae los campos
- `sql/2026-10-11-cm6b-incentivo-lectura-tope.sql`. `cm6-incentivo-topes` añadió columnas pero no recreó
  los RPC de **lectura**; ya recreados (cuerpo vivo + columnas al final, retrocompatible):
  - **`incentivo_listado(p_anio,p_semana,p_incluir_prueba)`** → `+ maximo numeric, puntaje_bruto numeric, topes jsonb`.
  - **`incentivo_mi_rendimiento()`** → `+ maximo numeric, puntaje_bruto numeric, topes jsonb` (tope semanal,
    bruto antes de recorte, y el snapshot `topes` que se aplicó esa semana → para el diario).
  - **`incentivo_semanas()`** → `+ maximo_semanal numeric` (`max(maximo)` del grupo = tope de la semana).
  - `contados`/`excedente` ya viajan **dentro de `conteos[renglon]`** (los puso `generar_semana`); no son columnas.
- **Valores `null` hasta que exista una versión de config CON tope y se regenere la semana** (las semanas ya
  generadas NO se recalculan, por diseño). La app muestra la barra de tope / chip "N sobre tope" sólo cuando
  `maximo != null`. 👤 Misael/Raykler ponen los números en *Incentivos › Configuración*.

### CK15b — "Ordenar el día" de Misael: el listado ya devuelve `orden`
- `sql/2026-10-10-ck15b-listado-orden.sql`. **`trabajos_transporte_listado(p_dia,p_estado,p_conductor_id)`**
  gana **`orden int`** al final del `TABLE(...)` (ya ordenaba por él internamente). La app ya puede cablear el
  botón "ordenar" (flechas) detrás de su capability-check. `trabajo_ordenar(origen,id,orden)` ya estaba vivo.
- Nota dev/prod: en **dev** la función lleva además el overlay demo `es_usuario_demo()` (revisor de tiendas,
  SOLO-dev, `2026-10-11-ck15b-dev-demo-overlay.sql`). Transparente para el app (mismo retorno con `orden`).

### CM7 (F6) — modo práctica: contrato del cliente
- **RPCs vivos en dev + prod** (grant `authenticated`):
  - **`practica_guardar_intento(p_mision_id text, p_version int, p_nota numeric, p_estrellas int, p_aprobada boolean, p_duracion_s int, p_detalle jsonb default '{}', p_plataforma text default 'web')` → `uuid`**.
    Valida `auth.uid()` y `nota 0-100`; recorta estrellas a 0-3. (El 404 que vio el app era previo a aplicar
    `cm7-practica`; ya está. La app lo llama con `p_plataforma:'app'`.)
  - `practica_puede_ver_equipo()` → bool · `practica_resultados_equipo()` → filas · `practica_resultados_persona(p_usuario_id uuid)`.
- **Diseño del cliente (realizado en web, la app lo copia):** simulador **100 % en memoria**, NO un fetch
  que intercepta Supabase. Las **misiones se definen en el cliente** (`practica.model.ts`: `MisionPractica`
  con `objetivos[]`/`penalizaciones[]`, cada objetivo con `cumple(r)` y puntos; campos simulados opcionales).
  El estado (`RespuestaPractica`) vive en señales, **nunca sale a la red**. `evaluar()` → `nota = max(0, Σobjetivos − Σpenalizaciones)`,
  estrellas 1/2/3 en `≥60/≥80/≥95`, aprobada `≥80`. Al cerrar, **lo único real** es `practica_guardar_intento`
  (detalle = `{objetivos:[{id,ok}]}`). No toca KPIs/incentivos/avisos. La app define sus propias misiones
  `app-*` (p. ej. `app-combustible`, `app-preuso`, `app-uso-vehiculo`) client-side; `mision_id` es texto libre
  (sin FK), así que no depende de semillas en `practica_misiones`.
- Panel de jefes: el jefe es `empleados.jefe_id`; si no hay relación, lo ven `admin`/`rrhh` (RLS de `practica_intentos`).

### CM2 (F4) — SVG del texto del logo
- **`src/assets/imgs/logos/csd-logo-texto.svg`** (trazo blanco de "Scheker & Dominguez / CONSTRUCTORA",
  `viewBox="205 0 235 108"`, pensado para colocarse a la derecha de `csd-logo-simbolo.svg` `0 0 206 108`).
  La app usa **este mismo archivo** en su logo-reveal en vez del texto "CSD APP". (La web renderiza hoy el
  texto con la tipografía de marca en el reveal; el SVG queda disponible para unificar si Xaviel lo aprueba.)

## Ronda CN (PROMPT-96 web → PROMPT-97 app) — 1.177.0-1.180.0

### CN4 — perfiles de bienvenida (contrato: la app lo copia idéntico)
El saludo del onboarding se resuelve por el **primer rol que coincida en ESTE orden** (prioridad);
con varios roles, gana el de arriba. La app (csd-app) debe usar la MISMA tabla y el MISMO orden
(su bug era saludar a un admin como "ingeniero"). Código real de `sgc.roles`. Fuente:
`src/shared/components/onboarding-web/onboarding-web.ts` (`PERFILES`/`resolverPerfil`), test `*.perfil.spec.ts`.

| # | Códigos de rol | Módulo (saludo) |
|---|---|---|
| 1 | `admin` | Administración |
| 2 | `direccion`, `gerencia` | Dirección |
| 3 | `desarrollador`, `encargado_tecnologia`, `tecnologia` | Tecnología |
| 4 | `abogado` | Legal |
| 5 | `jefe_rrhh` | RRHH |
| 6 | `coord_compras` | Compras |
| 7 | `jefe_flota` | Flota |
| 8 | `logistica` | Transporte |
| 9 | `gerente_proyectos`, `jefe_ingenieros` | Proyectos |
| 10 | `gerente_produccion`, `ingeniero_campo`, `ingeniero_oficina`, `capataz` | Obra |
| 11 | `encargado_patio`, `guarda_almacen` | Inventario |
| 12 | `chofer_transportista`, `chofer_privado` | Transporte |
| 13 | `revisor_tiendas` | Ayuda (demo) |
| — | (sin match) | genérico: "tu módulo / tu trabajo del día a día" |

### CN5 — momentos a pantalla completa (escenas)
La web elevó `momento(tipo)` a **escena a pantalla completa** (velo navy 92 %, halo+onda, escena,
check naranja 1,1s, título+dato, "Toca para continuar"; 1,8s). **Ráfaga:** un momento dentro de los
10s del overlay anterior sale como **tarjeta corta** (la mediana de siempre), hasta 10s de calma.
Reducido = velo+check+texto. Tipos: entrada, salida, aprobado, firma, combustible, checklist,
mantenimiento, mensaje, documento, **uso** (+ conduce CJ2 y ruta CJ3). La app replica el mismo
set de escenas y la misma lógica de ráfaga en su `celebracion`/`momento`.

### CM7 (F7a) — cliente de práctica (contrato para la app)
El modo práctica con **pantallas reales** usa un **cliente supabase-js con `fetch` propio** que
no sale a la red. La app replica el mismo diseño (`PracticaClienteService` en SGC):
- **Lecturas** (`GET /rest/v1/<tabla>`, `/rest/v1/rpc/<name>`) → salen del **escenario** de la
  misión (`{ tablas, rpc, funciones }`), datos de mentira; lo no definido = `[]`.
- **Escrituras** (POST/PATCH/DELETE) → se guardan **en memoria** (`escrituras[]`), devuelven una
  fila simulada; nunca viajan.
- **Edge functions** desconocidas → `{ error: 'No disponible en práctica' }`.
- **Realtime apagado.**
- **Candado de red:** la ÚNICA petición que sale de verdad es `practica_guardar_intento` (la nota).
  Hay una prueba (`practica-cliente.spec.ts`) que falla si sale cualquier otra cosa.
- `SupabaseService.client` devuelve este cliente mientras `practica.activa()` es true (getter),
  así la **pantalla real funciona sin cambios**. La misión declara `rutaReal` + `escenario`.
- La evaluación de la misión lee `escrituras[]` (lo que el usuario creó) contra los objetivos.

## Ronda CP (PROMPT-100 web → PROMPT-101 app) — 1.191.0+

### CP11.1 — `solicitudes_compra`: el aprobador ya puede leer su bandeja
La política SELECT de `sgc.solicitudes_compra` y `sgc.solicitud_compra_items` ahora suma
`aprobador_id = auth.uid()` (antes solo dejaba ver al solicitante, admin o alguien con el módulo
`compras` — un aprobador sin ese módulo veía la bandeja vacía aunque las RPCs de aprobar/rechazar
sí le funcionaban, porque corren `security definer`). `solicitud_compra_adjuntos` ya tenía el
criterio correcto desde CO8. Migración `sql/2026-10-16-cp11-compras-aprobador-rls.sql`, verificada
en dev con el usuario real de Eduardo Ng (ve sus 2 solicitudes tras el fix) y aplicada en prod.
**La app (csd-app) debe usar el mismo criterio** si construye una pantalla de "por aprobar" para
compras tecnológicas — con este fix, un aprobador sin módulo `compras` ya puede leer directo la
tabla sin pasar por una RPC intermedia.

### CP11.2 — `sgc-legal` política UPDATE + la web ya avisa si falla
La política UPDATE de `storage.objects` para el bucket `sgc-legal` (`sql/2026-10-16-sgc-legal-
storage-update-policy.sql`) ya estaba aplicada en dev y prod antes de esta ronda — la trajo la
sesión de la app (csd-app, PROMPT-99) porque `legal.service.ts` (app) sube con `upsert:true` y
Storage evalúa el upsert como `INSERT … ON CONFLICT DO UPDATE`, lo que dispara la política UPDATE.
**La web no tiene este problema** porque `shared/services/legal.service.ts:subirContratoFirmado`
sube sin `upsert` y ya envuelve la subida en try/catch con `toast.error(...)` si falla. **Contrato
para la app:** si `legal.service.ts` (app) también captura el error de `subirFirmado()` y lo
muestra al usuario (no solo loguea), queda igualado.

### CP11.3 — Legal sin límite por obra (decisión, no cambio de código)
Quien tiene el módulo `legal` ve **todos** los expedientes y contratos de **todas** las obras — no
hay RLS que lo limite por proyecto. **Decisión (default, Regla A):** se queda así — el equipo legal
(hoy Sonia Castillo) es pequeño y centralizado. **👤 Pendiente: confirmar con Sonia.** Si algún día
se requiere limitar, el patrón a seguir es `puede_ver_proyecto()` (CA2) — una función única reusada
por política y RPC.

### CP6 — `requisiciones_por_despachar()` gana código/urgencia/fecha (contrato app)
`sgc.requisiciones_por_despachar()` (la que alimenta `csd-app/.../transporte/despachos`) ya mandaba
`fecha`/`created_at`; ahora también devuelve `codigo` (`'REQ-' || lpad(folio,6,'0')`), `urgencia` y
`fecha_necesidad`. **Cambió el orden:** `order by created_at asc` (más viejas primero). Migración
`sql/2026-10-16-cp6-por-despachar-codigo.sql`. **Contrato app (mock `Por-despachar-app`, no
construido esta sesión — PROMPT-101 F2):** tarjeta con código + fecha relativa + obra +
renglones/solicitante + urgencia, grupo "Esperando hace más de 2 días" arriba. La web no necesitó
cambios (`inventario/requisiciones` ya muestra todo esto, lee la tabla directo).

### CP3/CP9 — Compa: edge compartida, contrato `archivos[]` (contrato para la app)
La edge `assistant` la usan **web y app por igual**. Cambios de esta ronda (en **dev**, pendientes
de OK de Xaviel para prod — ver HANDOFF):
1. **`archivos[]` en vez de `archivo`** — la respuesta ahora trae `archivos: {nombre,url}[]` (0, 1 o
   varios); se mantiene `archivo` (el primero, o `null`) solo por compatibilidad. La app debe iterar
   `archivos[]` en su tarjeta de descargas.
2. Modelo default pasó de Haiku a Sonnet vigente (`claude-sonnet-5`) — transparente para la app.
3. `generar_reporte_pdf` acepta `bodega_ids[]` (antes `bodega_id` único, se mantiene) + `separados`;
   tipo nuevo `'requisiciones'`.
4. Validador "prometió y no hizo" + gap rechazado si la tool existe + lista de tools en el prompt —
   mejora de comportamiento, sin cambios de contrato de red.
5. Tools nuevas de Reuniones: `mis_reuniones`, `acuerdos_pendientes`, `resumen_reunion` (ver CP8).

**Evals:** `supabase/functions/assistant/evals/casos.json` + `scripts/compa-evals.mjs` — corre
contra **dev** y verifica 12 casos (caso real de Hector + 10 por rol + 1 de Reuniones). Si la app
agrega tools propias al mismo edge compartido, sus casos van en el mismo `casos.json`.

**⚠️ Deploy del edge `assistant` a prod pendiente de OK de Xaviel** (en dev, 12/12 evals verdes) —
ver HANDOFF.md.

### CP8 — Módulo Reuniones (contrato para la app)
Backend completo en `sql/2026-10-16-cp8-reuniones.sql` (dev + prod, smoke-testeado con RLS real:
organizador, participante, tercero sin acceso correctamente rechazado). La app puede construir su
versión (lista + ficha con "Unirse", agenda, **mis notas** con dictado, **mis acuerdos**) contra las
mismas RPCs que usa la web — nada de esto es exclusivo del front:

- `reunion_tipos` (tabla, select público): `{id, codigo, nombre, color, agenda_default: string[], activo, orden}`.
  Semilla: obra, coordinacion, gerencia, proveedor, legal, rrhh, seguridad, cliente, otra.
- `reunion_crear(p_tipo_id, p_titulo, p_inicio, p_fin, p_modalidad['presencial'|'meet'|'mixta'], p_lugar, p_proyecto_id, p_expediente_id, p_solicitud_compra_id, p_participantes_usuarios uuid[], p_participantes_externos jsonb[{correo,nombre}], p_agenda text[]|null)` → uuid. El llamante queda de organizador y se agrega solo como participante. `p_agenda=null` copia `agenda_default` del tipo.
- `reuniones_listado(p_filtro['proximas'|'acta_pendiente'|'pasadas'|'mias'], p_tipo_id, p_proyecto_id)` → filas con conteos (`participantes_n`, `acuerdos_n`, `acta_lista`) y `fireflies_id` (si está poblado, pinta el chip "Fireflies entra").
- `reunion_detalle(p_id)` → **un solo jsonb** con `{reunion, participantes[], agenda[], notas[], acuerdos[], acta}` — pensado para una sola llamada por ficha.
- `reunion_nota_guardar(p_reunion_id, p_texto)` — upsert de la nota PROPIA (una por persona por reunión).
- `reunion_acuerdo_crear(p_reunion_id, p_texto, p_responsable_id, p_fecha)` → uuid.
- `reunion_acuerdos_crear_tareas(p_reunion_id)` → integer (creadas). Ojo: **NO reusa `asignar_tarea_obra`** (esa exige el submódulo `obra.plan_dia`, que no aplica a reuniones de legal/rrhh/gerencia/proveedor) — inserta directo en `sgc.tareas` con `linked_tipo='reunion', linked_id=<reunion_id>` (reusa la columna genérica existente, no hay `reunion_id` propio en `tareas`).
- `reunion_acta_guardar(p_reunion_id, p_resumen)` / `reunion_acta_aprobar(p_reunion_id)` (crea tareas pendientes + marca aprobada, devuelve cuántas) / `reunion_acta_marcar_enviada(p_reunion_id)`.
- RLS ya resuelta server-side vía `sgc.puede_ver_reunion(p_id)`: admin, organizador, participante (`usuario_id`), o cualquiera con el módulo `reuniones` (default: admin, gerencia/dirección, ingenieros, logística, abogado/legal, RRHH). La app no necesita reimplementar nada de esto.
- Módulo de permisos nuevo: `reuniones` (sumado a `MODULOS_DISPONIBLES` en roles.service.ts del padre).

**Fireflies/Calendar — NO están conectados todavía** (faltan pasos físicos de Xaviel: cuenta
`minutas@`, asiento Fireflies Pro, API key, webhook, scope `calendar.events` — ver
`docs/REUNIONES.md`). Mientras tanto, degradar igual que la web: sin `enlace`, mostrar "Calendar no
conectado — copiar invitación" (botón que arma un texto plano con título/fecha/participantes para
compartir a mano); sin `transcripcion_url`, no ofrecer "Ver transcripción"; "Aprobar y enviar minuta"
hoy NO manda correo real (solo marca `enviada_at` tras aprobar) — no afirmar que se envió un correo.

### CQ3 — Auditoría › Actividad (contrato para la app)
Rediseño del módulo de Auditoría en la web (3 pestañas: Actividad / Resumen / Acciones de admin —
mock `Auditoria.dc.html`). Si `csd-app` necesita alguna vez una vista mínima de "qué hice / qué pasó"
(ej. para un admin de obra en el teléfono), estas son las mismas RPCs que usa la web — nada exclusivo
del front. Migración: `sql/2026-10-16-cq3-auditoria-contexto.sql` (dev; prod pendiente de OK de
Xaviel — ver HANDOFF).

- `sgc.auditoria_actividad(p_filtros jsonb, p_cursor text, p_limite int default 40) returns jsonb`
  — línea de tiempo paginada por **cursor** (no OFFSET — el log pasa de 40k filas). `p_filtros` acepta
  `{persona, texto, desde, hasta, modulo, accion}` — **`desde`/`hasta` deben venir ya resueltos a
  `YYYY-MM-DD`** (el RPC no entiende atajos como "7 días", eso lo resuelve el cliente). Devuelve
  `{filas: [...], cursor_siguiente: string|null, hay_mas: boolean}`. Para la página siguiente, mandar
  `cursor_siguiente` tal cual (es opaco — base64 de `creado_en|id`, no parsear).
  Cada fila: `{id, tabla, registro_id, accion, creado_en, actor_id, actor_nombre, actor_roles[],
  impersonado_por, impersonador_nombre, origen, frase_resumen, codigo, resumen_cambio, cambios,
  datos_antes, datos_despues}`. `frase_resumen` y `codigo` ya vienen armados en servidor (catálogo
  `sgc.auditoria_frases`) — **nunca** reconstruir la frase en el cliente a partir de `cambios` crudo,
  usar `frase_resumen` tal cual. `origen` es `"web@1.193.0"` / `"app@2.55.0"` / `null` (si es anterior
  al 16-oct-2026 o el cliente no mandó el header — mostrar "No disponible", nunca inventar un valor).
- `sgc.auditoria_historia_registro(p_tabla text, p_registro_id text) returns jsonb` — TODAS las
  acciones de TODOS los usuarios sobre un registro, en **orden cronológico ascendente** (mismas
  columnas por fila que `auditoria_actividad`, sin paginar — un registro no tiene miles de eventos).
- Gate: ambas llaman `sgc.puede_ver_auditoria()` (admin, módulo `auditoria`, o `es_tecnologia()`) —
  mismo gate que ya usa `auditoria_listar`/`auditoria_resumen`.
- **"Desde dónde" en la app**: si `csd-app` manda su propio header `x-sgc-client: app@2.55.0` en las
  llamadas a Supabase (mismo patrón que la web, ver `supabase.service.ts` de la web), `fn_auditoria()`
  ya lo captura automáticamente — no requiere ningún cambio de servidor adicional. Sin ese header,
  las filas de auditoría generadas por la app seguirán quedando con `origen=null`.
- `sgc.auditoria_frases` es un catálogo de 35 tablas (de las ~30 más auditadas en prod); si la app
  necesita una tabla que no está ahí, el RPC cae a un genérico ("modificó un registro de {tabla}") —
  nunca revienta ni deja la frase vacía. Agregar tablas nuevas al catálogo es un `insert` aditivo en
  `sql/`, no requiere tocar los RPCs.

### CQ2 — Dev notes: editor con formato (contrato para la app)
Rediseño del editor de Dev notes en la web (mock `Dev-notes.dc.html`): reemplaza el `<textarea>` de
Markdown crudo por un editor **con formato real**, a pantalla completa. NO implementado en `csd-app`
en esta ronda — solo se documenta el contrato por si el hijo construye su propia versión más adelante
(dev notes hoy es una pantalla solo-web, gateada a Tecnología; la app no la tiene).

- **Mismo storage, sin cambios de esquema de datos**: `sgc.notas.contenido` sigue siendo **Markdown
  plano**, igual que antes de esta ronda. El editor nuevo es puramente de presentación — convierte
  Markdown→doc visual al abrir y doc→Markdown al guardar; la base de datos nunca ve HTML ni JSON de
  ProseMirror. Si la app alguna vez edita una nota 'dev' directamente contra la tabla (hoy no lo hace),
  sigue leyendo/escribiendo el mismo Markdown de siempre — no necesita saber nada de TipTap.
- **Tecnología usada (si el hijo migra su propio editor de notas)**: TipTap 2.x (`@tiptap/core` +
  `starter-kit` + `extension-task-list`/`extension-task-item`/`extension-link`) + el paquete
  `tiptap-markdown` para la conversión Markdown↔ProseMirror. Implementación de referencia en
  `src/shared/ui/rich-editor/rich-editor.ts` (web) — el menú "/" es un popup casero (sin librería de
  suggestion), y hay un workaround documentado ahí mismo (`repararListaFantasma`) para un bug real de
  `tiptap-markdown`/`markdown-it-task-lists` con listas mixtas (bullet normal seguida de checkboxes
  con el mismo marcador `-` en el mismo bloque) — si el hijo usa la misma librería, revisar ese mismo
  workaround o el bug reaparecerá ahí también.
- **Columna nueva (aditiva, no rompe nada): `sgc.notas.enviada_a_ronda_at timestamptz`** — se pone en
  `now()` cuando el usuario usa "Mandar a ronda" (copia el contenido al portapapeles como texto plano
  legible, sin sintaxis Markdown cruda, para pegar en un chat). RPC: `sgc.nota_marcar_enviada_ronda(p_id
  uuid)` (mismo gate que editar la nota, vía `sgc.puede_editar_nota`). Puramente informativo — no
  bloquea nada ni cambia visibilidad. Migración: `sql/2026-10-16-cq2-dev-notes-enviada.sql` (aplicada a
  dev; prod pendiente del flujo normal `dev→main`).
- **Pantalla completa**: mecanismo nuevo y genérico, `FullscreenModeService`
  (`src/shared/services/fullscreen-mode.service.ts`) — un signal `activo` que el shell web consulta
  para ocultar su propio chrome (sidebar+header) mientras hay una nota abierta. Es un concepto de la
  WEB (sidebar persistente); no aplica igual a la app (que ya es pantalla completa por naturaleza al
  ser móvil) — no hace falta portarlo, solo tenerlo en cuenta si el hijo agrega algún "modo inmersivo"
  propio para otra pantalla.
- **Ctrl+N global** (`DevNotesAtajosService`, atajo de teclado — no aplica a touch/móvil, es
  exclusivamente de la web).
- **"Texto simple"**: alterna el MISMO editor a un `<textarea>` monoespaciado sin formato — el
  contenido subyacente no cambia (sigue siendo el Markdown). Si la app quisiera un modo similar, es
  trivial (es solo una UI alternativa sobre el mismo string).

### CR1 — Conector de Claude Desktop (contrato para la app, PROMPT-105)

MCP/OAuth son conceptos de **web** (Claude Desktop se configura en una computadora,
no en el teléfono — mock `Perfil-claude-app`). La app solo necesita el contrato
de **borradores** y **conexión**, todo vía Supabase directo (no hay edge nueva
exclusiva de app):

- **`sgc.claude_borradores`** (tabla, RLS dueño/admin): `{id, tool, params jsonb,
  resumen, estado: 'pendiente'|'confirmado'|'descartado'|'caducado', creado_en,
  expira_en, resultado jsonb}`. La app puede listar los propios con
  `select * from sgc.claude_borradores where estado='pendiente' and expira_en > now()`
  (RLS ya filtra a `usuario_id = auth.uid()`).
- **Edge `claude-borrador`** (`POST`, JWT de usuario): `{accion: 'get'|'confirmar'|'descartar', id}`.
  `get` devuelve `{borrador, detalle: [{etiqueta, valor}]}` con nombres ya
  resueltos (obra, artículos) — la app NO necesita resolverlos ella misma.
  `confirmar` devuelve `{ok, mensaje, duplicado?}`; confirmar dos veces el mismo
  borrador es seguro (AU1, idempotente — nunca duplica el documento).
- **Edge `claude-conexiones`** (`POST`, JWT de usuario): `{accion: 'desconectar'}`
  corta las conexiones OAuth de Claude de la propia persona (self-service, sin
  parámetros extra). `{accion: 'revocar', usuario_id}` es solo-admin.
- **RPC `sgc.claude_mi_conexion()`** (sin argumentos): `{conectado, desde,
  ultima_actividad, consultas_7d, borradores_pendientes}` — todo lo que la
  pantalla `Perfil-claude-app` necesita (mock: estado, desconectar, borradores
  pendientes con "Revisar y confirmar").
- **Texto de la hoja "Revisar y confirmar"**: el mock app usa `resumen` +
  `creado_en`/`expira_en` del propio borrador — mismo shape que la web, no hace
  falta un endpoint aparte.
- **Conectar Claude Desktop es solo-web**: la app únicamente MUESTRA el estado y
  deja desconectar/revisar — el flujo de los "3 pasos" (copiar enlace, Claude
  Desktop, Connect) vive en `Perfil-claude` (web) y el mock app lo dice
  explícitamente ("usa la guía en Perfil › Claude de la web del SGC").

## Ronda CT (PROMPT-108 web → PROMPT-109 app) — 1.196.0

### CT4/CT7 — `crear_solicitud_app` cambia de `returns uuid` a `returns jsonb` + detección de duplicado
**Causa:** Emmanuel Peralta mandó la misma requisición dos veces porque la primera "no aparecía"
(el teléfono la guarda local antes de que el servidor confirme). `crear_solicitud_app` ya era
idempotente por `p_id`, pero un reintento desde la app genera un `p_id` NUEVO, así que esa
idempotencia no detecta el duplicado real.

**Contrato nuevo (migración `sql/2026-10-20-ct4-requisicion-duplicada.sql`, aplicada a dev):**
```
sgc.crear_solicitud_app(
  p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb,
  p_fecha_necesidad date default null, p_forzar boolean default false   -- NUEVO parámetro
) returns jsonb   -- ANTES: returns uuid
```
La respuesta ahora es `{ "id": uuid, "duplicada_de": uuid | null, "folio": text }` en vez de un
uuid plano:
- `duplicada_de = null` → se creó una requisición nueva (`id` es la nueva).
- `duplicada_de != null` (igual a `id`) → el servidor encontró una requisición del MISMO
  solicitante + MISMA obra + MISMOS renglones (articulo_id/descripcion + cantidad) creada en las
  últimas 24h, y devolvió **esa** en vez de crear otra. `folio` trae el código `REQ-xxxxxx` para
  mostrarlo en el aviso.
- Enviar `p_forzar: true` se salta la detección y siempre crea una requisición nueva (por si el
  usuario de verdad quiere dos iguales).

**Lo que la app (PROMPT-109 F2) necesita cambiar:**
1. Donde hoy se lee `data` de `crear_solicitud_app` como un uuid string directo, pasar a leer
   `data.id` (el shape cambió de `uuid` a `jsonb`).
2. Si `data.duplicada_de` viene no-nulo: mostrar un aviso tipo "Ya enviaste una igual hace poco
   (`{folio}`)" en vez de (o adicional a) la hoja de éxito normal — no es un error, la requisición
   SÍ existe, solo que es la de antes.
3. **CT7 (relacionado, resuelto en la app, no en el servidor):** la hoja de éxito y la barra "Todo
   enviado" hoy confirman que la requisición se GUARDÓ EN EL TELÉFONO, no que el servidor la
   recibió — por eso "siempre dice enviada" aunque el servidor nunca la vea. La requisición nueva
   debería aparecer en "Mis requisiciones" como **"Enviando…"** hasta que la llamada real a
   `crear_solicitud_app` confirme, y pasar a **"Enviada · REQ-xxxxxx"** con el folio real recién
   entonces (ver CONTEXTO-53 §3 B4).
4. `crear_solicitud_material` (la RPC que usa la web, no la app) tiene el MISMO cambio de
   contrato (`returns jsonb` + `p_forzar`) — no debería afectar a la app salvo que algún flujo la
   llame directamente.

### CT3a — "Ver conduce" sin crear un borrador de recepción (pendiente, app)
`recibir.ts`: tocar un conduce en la lista hoy llama `abrir(c)`, que abre la hoja de recepción y
(por el `effect` de autosave) crea un borrador de recepción SOLO por mirarlo. Falta separar "Ver
conduce" (solo lectura, sin tocar el borrador) de "Recibir" (sí lo crea) — pendiente de
PROMPT-109 F1, no se tocó en esta ronda (es 100% app).

### CT5 — borrador de recepción: falta listarlo + banner de retomar (pendiente, app)
El borrador de recepción de conduces YA EXISTE (`recibir.ts` guarda cantidades/notas/fotos y
`CameraService` lo restaura si el SO mata la Activity) — lo que falta es que
`en-proceso.service.ts` incluya `recibir` en `BORRADOR_TIPOS` (hoy no aparece en "Documentación en
proceso") y un banner "Tienes una recepción sin terminar · Retomar/Descartar" en inicio. El crash
de la cámara a 0.6x necesita `adb logcat` de un teléfono real — no se puede diagnosticar desde el
código. Pendiente de PROMPT-109 F3, no se tocó en esta ronda (es 100% app).

### CT8 — "Cambiar despachante" (web, 100% — sin contrato nuevo para la app)
Nueva RPC `sgc.conduce_cambiar_despachante(p_salida_id, p_despachante_nombre, p_despachante_usuario_id, p_despachante_empleado_id, p_motivo)` — solo la usa la ficha web del conduce. Si la app (csd-app) algún día necesita el mismo botón, puede llamar la misma RPC directo (mismas reglas de permiso que `conduce_asignar_receptor`/CK4, ya usada por la app).

### CT10 — Envíos automáticos (100% servidor/web, sin acción para la app)
Los 4 crons que ahora respetan `sgc.envios_automaticos` (resumen de operaciones, incentivo semanal, avisos de reporte semanal, cronograma) corren del lado del servidor — la app no los llama ni los necesita tocar.

## Ronda CU (PROMPT-110 web) — 1.197.0 — sin contrato nuevo para la app

CU1 ya estaba cerrado por CT8 (ver arriba). CU2 (seguridad RLS/default privileges en `public`/`sgc`) y CU3 (`sgc.envio_automatico_probar` + override `destinatario_prueba` en los edges de resumen/incentivo) son 100% servidor/panel de Tecnología — la app no los llama ni los necesita tocar. PROMPT-111 (app) no tiene nada pendiente de esta ronda.

## Ronda CV (PROMPT-112 web) — 1.198.0 — contrato para PROMPT-113 (app)

### CV1 — Compa prepara la echada ("Registra una echada" → `preparar_echada` → "Abrir formulario")
Felix le pidió a Compa "Registra una echada" y Compa, con razón, dijo que no podía (solo
`log_combustible`, de lectura). No se agregó una herramienta que EJECUTE: el servidor
(`sgc.registrar_combustible_app`) no exige las 2 fotos, así que una echada creada desde el chat
saldría sin evidencia (deuda anotada en `docs/SEGURIDAD.md`, no corregida aquí). El camino
aprobado: **preparar + abrir el formulario real** — Compa nunca guarda, nunca sube fotos.

**Herramienta nueva `preparar_echada`** (`supabase/functions/_shared/herramientas.ts`):
`canales:['compa']` únicamente (no se ofrece en MCP). Entradas: `vehiculo_id`/`galones`/`monto`
obligatorios, `km`/`estacion`/`producto` opcionales. Misma compuerta que la pantalla: módulo
`flota` (confirmado: `tiene_modulo('flota')` ya implica `operar` en todo `flota.*`, incluido
`flota.combustible` — no hace falta compuerta granular aparte).

**Contrato de la propuesta** (`AsistentePropuesta` ampliada en `shared/services/asistente.service.ts`):
```ts
interface AsistentePropuesta {
  tipo: 'tarea' | 'requisicion' | 'conduce' | 'ruta' | 'echada_formulario'; // nuevo valor
  accion?: 'abrir';                 // presente SOLO en propuestas "preparar + abrir"
  destino?: { vehiculo_id: string; query: Record<string, string | number> };
  faltan?: string[];                // p. ej. ['Foto del recibo', 'Foto del tablero', 'Lectura del odómetro']
  // … tool, params, titulo, lineas, idem?, es_prueba?, aviso_prueba? (igual que siempre)
}
```
Cuando `accion === 'abrir'`: la tarjeta de Compa NO tiene "Confirmar" — una sola acción naranja
"Abrir formulario" (navega con `destino.query` como parámetros) + "Descartar". La edge de
`assistant` **rechaza** confirmar este tipo de propuesta por la vía de siempre (`payload.ejecutar`):
si un cliente intenta confirmarla de todos modos, responde `{ejecutado:false, respuesta:"Esta
acción se completa en el formulario de Combustible…"}` en vez de ejecutar algo o tirar un error.

**`destino.query` para la echada** (los mismos nombres de parámetro que ya usa la app en sus
propios deep-links `?fecha=`/`?corregir=`/`?reenviar=` de `transporte/combustible/combustible.ts:412-430`):
`desde=compa` (fijo), `galones`, `monto`, `km` (si vino), `estacion` (si vino), `producto` (si
vino) + `vehiculo` (el id, además de `destino.vehiculo_id`).

**Lo que la app (PROMPT-113 F1) necesita construir:**
1. La hoja inferior de Compa ya existe (`compa.ts:301-335` + `Propuesta` en
   `core/models/compa.model.ts`) — ampliar el modelo con los mismos campos
   `accion?/destino?/faltan?` y, cuando `accion==='abrir'`, mostrar el mismo patrón (aviso +
   un solo botón "Abrir formulario", sin "Confirmar") en vez del genérico actual.
2. "Abrir formulario" navega al wizard de combustible de la app con esos mismos nombres de
   parámetro (puede reusar el parseo que ya existe para `?corregir=`/`?reenviar=` en
   `combustible.ts:412-430`, añadiendo el caso `desde=compa`).
3. **Mismo orden de prioridad** que ya tiene la app (`corregir` > `reenviar` > deep-link por
   vehículo > borrador BT4) — `desde=compa` entra en el mismo nivel que el deep-link por
   vehículo existente (antes del borrador BT4): si hay un borrador local sin terminar, se
   muestra su aviso de siempre y los datos de Compa se aplican solo si la persona lo descarta
   (CV1.6) — NUNCA pisa un borrador sin avisar.
4. El odómetro, si no vino en `query`, se deja vacío (la app ya tiene su propio control de
   "Compa no la inventa" — mismo texto que la web, por consistencia). Las fotos siguen 100%
   obligatorias — el wizard ya las exige, no se toca esa validación.
5. **CV1.7 (verificar, no construir):** el OCR del recibo (`leerReciboAuto`) de la app ya
   respeta `sobrescribir=false` (`combustible.ts:~1030`) — confirmar que no pisa lo que Compa
   prellenó; si el OCR lee algo distinto, debe salir el aviso de diferencia que ya existe.

### CV2/CV3 — Dev notes: grupos y arrastre (100% web, sin acción para la app)
La app (`core/services/notas.service.ts:73-75`) solo **lee** los grupos de Dev notes (CS2, ya
en paridad) — no crea, renombra, mueve ni elimina grupos, y no tiene arrastre. PROMPT-113 F2
solo necesita **verificar** que un grupo creado/renombrado/movido desde la web se refleje bien
en la ruta "Carpeta / Sub" que ya pinta la app — sin construir nada nuevo.

## Ronda CZ (PROMPT-120 web → PROMPT-121 app) — contrato para la app

### CZ5 — Dev notes: soltar sobre cualquier tarjeta del grupo (100% web, sin acción para la app)
Dev notes en la app es **solo lectura** (ver CV2/CV3 arriba) — sin arrastre, así que este fix
(`zonaDestinoDeFila()`, `src/shared/utils/nota-grupos.util.ts`) no tiene contrapartida en la app.

### CZ1/CZ2 — Biblioteca de Cotizaciones de Tecnología (contrato para la app)
Tablas nuevas `sgc.tec_cotizaciones` (id, titulo, proveedor, fecha, moneda, subtotal, itbis,
total, estado `vigente|usada|descartada`, archivo_path/nombre, lectura/lectura_costo_usd,
adjunto_id, notas, creado_por, es_prueba) + M:N opcionales `tec_cotizacion_compras`
(cotizacion_id, solicitud_compra_id) y `tec_cotizacion_equipos` (cotizacion_id, equipo_id,
linea_idx). RPCs: `cotizacion_crear/actualizar/descartar/restaurar/setear_archivo`,
`cotizacion_vincular_compra/desvincular_compra/vincular_equipo/desvincular_equipo`,
`cotizacion_de_equipo(p_equipo_id)` (resuelve la cotización de origen: directa o, si no hay,
la `usada` de `tec_equipos.origen_solicitud_compra_id`). Gate: `sgc.puede_ver_submodulo` /
`puede_operar_submodulo('tecnologia.cotizaciones')` — admite módulo `tecnologia` (completo) o
el permiso granular suelto (el caso del Subadministrador, CZ4). El archivo reusa el bucket
`compras-cotizaciones` (CO8), bajo `biblioteca/<cotizacion_id>/…` cuando no nace de una compra.
`compra_tec_adjuntar_cotizacion`/`compra_tec_elegir_cotizacion` (CO8/CQ1) ahora también
escriben/reflejan en la biblioteca — **sin cambiar su firma**, la pantalla de Compras de la
app sigue igual si alguna vez las llama directo.
**PROMPT-121 (app, CZ6):** según la respuesta de Xaviel ("de todas formas está segmentado...
me sería útil tener fácil acceso... si estoy lejos de mi laptop"), Cotizaciones **sí va en la
app**, pero de solo **lectura y vínculo** (DZ-25: requiere conexión, sin cola offline) —
alcance sugerido: lista + detalle + abrir archivo + ver vínculos; **crear/editar/descartar
sigue siendo solo web** (como las compras tecnológicas ya son solo-web hoy). Mismo gate
granular `tecnologia.cotizaciones` del lado servidor.

### CZ4 — Rol Subadministrador (contrato para la app)
Rol nuevo `subadmin` (`sgc.es_subadmin()`). La app hoy no tiene un concepto de rol
"Subadministrador" en su UI (gating por módulo/rol como ya existe). **PROMPT-121 (A0,
verificar)** solo necesita confirmar que un usuario con este rol ve en la app EXACTAMENTE
los módulos de su lista (inventario/compras/proyectos/flota/bitacora/documentos/plantillas/
tareas) y nada de Tecnología de plataforma — sin construir pantallas nuevas (el modelo de
permisos de la app ya deriva de `roles.modulos`/`capacidades_asistente()`, igual que la web).

### CZ3/CZ9 — Vault (contrato para la app, PROMPT-121 A2)
Backend (edge `boveda`, tablas `sgc.boveda_*`) construido 100% en esta ronda (F4), **sin
ninguna pieza nueva del lado app todavía**. Respuesta de Xaviel sobre si va en la app: **sí**
("me sería útil tener fácil acceso a esos datos cuando los necesite si estoy lejos de mi
laptop"), pero **segmentado al rol Administrador** igual que en la web, y con alcance MÁS
ESTRECHO que la web (DZ-19):
- **La app puede:** buscar, ver metadata, **revelar** un valor (reautenticación con
  contraseña real, sesión de **2 min** en vez de 5), **copiar**, ver el **código 2FA actual**,
  y usar el **generador** de claves (100% en el dispositivo, mismo algoritmo que
  `src/shared/utils/boveda-generador.util.ts` — hay que portarlo, sin dependencias nuevas).
- **La app NO puede:** crear, editar, eliminar, importar ni exportar entradas — eso
  sigue siendo **solo web** (symmetric con "compras tecnológicas solo-web" de otra ronda).
- **Nada se guarda en el dispositivo:** sin `localStorage`/caché local del valor revelado;
  la ruta de la edge `boveda` debe quedar **excluida de cualquier cola offline/service worker**
  de la app (igual que la web no lo cachea).
- **Pantalla protegida (Android):** `FLAG_SECURE` (o el plugin de pantalla de privacidad que
  el hijo ya tenga) en la pantalla del Vault — evita capturas de pantalla / vista en
  "recientes" mientras un secreto está visible.
- Reusa la MISMA edge `boveda` (header `x-sgc-client: app` para que la sesión dure 2 min en
  vez de 5 — ya implementado en el servidor, `SESION_MINUTOS` en `supabase/functions/boveda/
  index.ts`), el mismo `pinGuard` ya activo, y la misma reautenticación server-side.
- **Nunca entra a Compa/MCP** (DZ-15) — ni en la app tampoco.

### DA (ronda DA, PROMPT-122) — Inventario tecnológico (contrato para la app, PROMPT-123)
Backend 100% construido en esta ronda (F1-F7), **ningún cambio del lado app todavía**.
La app (`csd-app`) ya tiene `pages/tecnologia-inventario/{equipo-detalle,equipo-form}` y
`core/services/tecnologia.service.ts` con catálogo en caché `tec_equipos` — necesita subir
de versión para traer las columnas/tablas nuevas y mostrarlas (DA-19):
- **Situación/condición** pasan de union fijo a catálogo (`tec_equipo_estados`/
  `tec_equipo_condiciones`, select público). La app debe pintarlas como catálogo (igual
  que ya hace con `tec_equipo_tipos`), no como enum cerrado — y mostrar AMBAS por
  separado (antes solo había "estado").
- **Specs por tipo** (`tec_equipo_specs`, 1:1) + `grupos_campos` del tipo deciden qué bloque
  mostrar — mismo patrón que la web (F2).
- **Kits** (`kit_padre_id`, `presente`, vista `tec_kits_estado`, RPCs `tec_kit_mover`/
  `tec_kit_mover_pieza`): la ficha de un kit lista sus componentes con su estado
  presente/falta; mover/asignar kit completo o una pieza suelta.
- **Responsable externo, costo_origen, fecha/garantía "desconocida"**: campos nuevos,
  mostrar y editar igual que en la web.
- **Clave del equipo (DA4/DA6) — alcance MÁS ESTRECHO que la web (mismo patrón que el
  Vault):** la app puede **ver** (edge `equipos-clave`, header normal, sin sesión de
  reautenticación propia — esta pieza NO es el Vault, no reusa `boveda`) y **cambiar/quitar**
  si el usuario tiene el permiso granular `tecnologia.claves_equipos`; **nada se guarda en el
  dispositivo** (sin `localStorage`/caché del valor), mismas salvaguardas que el Vault móvil
  de CZ (pantalla protegida Android, valor visible 30 s). Requiere conexión (no hay cola
  offline para esto). **Nunca entra a Compa/MCP** (DA-17, mismo gate que el Vault).
- **Lector de capturas de Windows, carga en lote, importador, QR de impresión: SOLO web**
  (DA-19) — la app no construye nada de esto.
- El catálogo en caché `tec_equipos` (`CATALOG_EQUIPOS`) sube de versión para traer las
  columnas nuevas; invalidar en los mismos puntos que ya invalida hoy.

## Decisiones (Ronda DB, 29/10/2026) — contrato para la app (PROMPT-125)

| Capacidad | Web (padre) | App (hija) — qué le toca |
|---|---|---|
| **DB12 Mi unidad** | RPC `mi_unidad()` (uso abierto > asignación activa; `visible` honesto + `en_uso_por`); el cron ya no cierra a las 24 h un uso con asignación activa (tope `uso_vehiculo_max_dias_asignado`=7) | A2: tarjeta «Mi unidad» arriba en Transporte, «Tomar mi unidad (1 toque)», picker pone «Mi unidad» primero |
| **DB13 Proyectos** | Causa real (F0): **PGRST201/HTTP 300** — 4 FKs `proyectos→usuarios` (AT19/AZ9) hacen ambiguo `responsable:usuarios(nombre)` | A1: `proyectos.service.ts` SELECT → `responsable:usuarios!proyectos_responsable_id_fkey(nombre)`; aplica a cualquier otro embed `usuarios(` sobre proyectos |
| **DB14 chunk viejo** | Ya se auto-repara (CO7, `chunk-reload.util`) | A1: `ErrorHandler` detecta la familia MIME/chunk → `autoRepair('chunk_perdido')` (candado 60 s); `VERSION_INSTALLATION_FAILED` repara a la 1ª si es red/404 |
| **DB7 Compa** | `invokeEdge` + retry 1.5 s + firma `compa_transporte`; `ORIGENES_SGC` + `www.` | A1: verificar que Compa app muestra mensaje humano en fallo de transporte (mismo helper si no) |
| **DB9 requisición** | Mapper siembra `pendiente` + chip «Cubierto M»; `aprobar_requisicion` capa en servidor (db4) | A1: la vista de requisición muestra pedido/cubierto/pendiente por renglón (`requisicion_avance`) |
| **DB5 personal 2 fotos** | Edge `leer-documento-personal` (2 fotos → campos + `coincide_rostro`); levantamiento diario (db9: `levantamiento_de_hoy/marcar/cerrar`); Excel | A3: mismo wizard reducido (2 fotos→precarga→cargo→firma), «Levantamiento de hoy», Excel con `xlsx` |
| **DB4 pagos/descargo** | db15: `pagos_obra(_lineas)`, RPCs crear/guardar/enviar/complemento/reabrir; edge `pagos-descargo-enviar` (PDF+Resend); firma = pad al bucket `obra` `pagos/<pago>/firmas/<linea>.png` | A4: lista de semanas de MIS obras + firmar línea a línea (outbox offline; enviar requiere conexión) |
| **DB3 lector flota** | Edge `leer-documento-flota` (PDF/20 fotos, por página) + `flota_documentos_emparejar/aplicar` (nunca pisa vigencia más nueva) | A5: «Leer documento» con UNA foto desde la ficha del vehículo (mismos RPCs) |
| **DB1 tablero** | `tablero_vivo_resumen()` + Realtime (6 tablas, db14) + «Hoy, en vivo» en el Inicio | A6: feed «Hoy» del inicio (sin mapa), mismo RPC, momentos existentes |
