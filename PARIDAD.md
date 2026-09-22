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
