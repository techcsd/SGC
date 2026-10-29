# DATOS Y TERCEROS — inventario vivo (CI13)

> **Fuente única** del tratamiento de datos de la **CSD App** y la **web SGC**. La usan:
> la Política de Privacidad (`src/assets/politicas/privacidad.md`), la hoja de consentimiento de IA (CI10),
> los formularios de "Seguridad de datos" (Google Play) y "Privacidad de la app" (App Store), y `docs/TIENDAS-DATOS.md` (hijo).
>
> **Regla (CLAUDE.md, ambos repos):** toda función que recoja un **dato nuevo** o use un **tercero nuevo**
> actualiza este documento **y avisa que la política y los formularios de tienda deben revisarse**.
>
> Última revisión: **07-oct-2026** (CI13). Verificado contra el código (edges en `supabase/functions/*`,
> servicios en `src/` y en `../dev2/csd-app/src/`). Responsable del documento: Tecnología (tecnologia@constructorasd.com).

## 0. Dónde viven los datos (regiones y responsables)

| Pieza | Proveedor | Región real (verificada) | Qué guarda |
|---|---|---|---|
| Base de datos + Storage + Auth (**prod** `csd-core` / `jeeqhgccqefbqilntcpu`) | Supabase (AWS) | **us-east-1 — EE. UU. (Norte de Virginia)** | Todo el dato de negocio y los archivos |
| Base de datos de **pruebas** (`sgc-dev` / `fzfrnrvndzrjwyvdpkgg`) | Supabase (AWS) | **us-east-1 — EE. UU.** | Datos sembrados de prueba (no reales) |
| Hosting de la web SGC | Vercel | **EE. UU. (despliegues `iad1`, CDN global)** | Sitio estático; sin dato personal en reposo (solo logs de petición del CDN) |

**Transferencia internacional:** la empresa opera en **República Dominicana**; los datos se procesan en servidores en **EE. UU.** (Supabase/AWS, Vercel) y, cuando aplica, en los proveedores de la tabla §2. Esto se declara en la política (Ley 172-13, transferencias a proveedores fuera del país).

## 1. Datos que se recogen → dónde viven → para qué

| Dato | Dónde se guarda (tabla / bucket) | Finalidad | ¿Vinculado al usuario? |
|---|---|---|---|
| Nombre, correo, teléfono, **cédula**, cargo, rol | `sgc.usuarios`, `sgc.conductores`, `sgc.personal_obra` | Cuenta, identificación y operación | Sí |
| Contraseña / PIN (hash) | Supabase Auth · `sgc.usuarios` (PIN hash) | Inicio de sesión | Sí |
| **Ubicación precisa** (también en 2.º plano, choferes que comparten) | `sgc.chofer_posiciones`, `sgc.chofer_ultima_posicion`, `sgc.recorridos_diarios` | Seguimiento de flota y registro de rutas | Sí |
| Estado del chofer (disponible/en ruta/…/inactivo) | `sgc.chofer_estado`, `sgc.chofer_estado_historial` | Jornada; **controla el encendido del GPS** (CI5) | Sí |
| Fotos (cámara/galería), firmas, PDFs | Buckets `sgc-bitacora`, `sgc-documentos`, `sgc-rrhh`, `sgc-avatars`, `vehiculos`, `conductores`, `mantenimiento_adjuntos`, etc. | Evidencias de obra, inventario, flota, RRHH | Sí |
| **Audio** (notas de voz) | Bucket de audio · `sgc.audio_notas` | Incidentes/notas; se transcribe (ver §2 IA) | Sí |
| Identificadores del dispositivo, **token de push**, plataforma, versión de app | `sgc.device_tokens`, `sgc.platform_reports` | Notificaciones, soporte | Sí |
| Registros de error / diagnóstico | `sgc.reportes_error` (y afines) | Soporte técnico | Sí |
| Biometría (huella/rostro) | **Solo en el teléfono** (`@aparajita/capacitor-biometric-auth`); **nunca sale del dispositivo** | Desbloqueo de la app | No (local) |
| Uso de IA (conteo, para límites) | `sgc.uso_ia` | Control de abuso/costos de las funciones de IA | Sí |
| Consentimiento de IA / ubicación en 2.º plano | `sgc.consentimientos` (CI10) | Prueba de permiso explícito (tiendas) | Sí |
| Aceptación de políticas (versión, fecha) | `sgc.aceptaciones_politicas` (CI3) | Prueba de aceptación de privacidad/términos | Sí |
| Solicitudes de eliminación de cuenta | `sgc.solicitudes_eliminacion_cuenta` (CI4) | Derecho de cancelación (Ley 172-13) | Sí |
| **Credenciales, llaves API y tokens, semillas 2FA, notas/archivos de la empresa (Vault, CZ3)** | `sgc.boveda_entradas` (cifradas AES-256-GCM en servidor; columnas en claro **sin SELECT para `authenticated`**), `sgc.boveda_accesos` (auditoría, solo-insertar) | Custodia de credenciales de administrador/desarrollo de la empresa (no son datos personales de empleados) para continuidad del negocio | No es dato de un empleado — son credenciales de **sistemas/servicios** de la empresa, administradas por el rol Administrador |

**No se recoge:** datos de publicidad, rastreo entre apps/sitios (sin App Tracking Transparency), ni datos de menores (app de empleados).

**Vault (CZ3) — sin tercero nuevo:** el cifrado es propio (AES-256-GCM en la edge `boveda`, llave `BOVEDA_MASTER_KEY` en los secrets de Supabase, distinta por entorno) — no se envía ningún secreto a un servicio externo; sigue viviendo en la misma base de datos de Supabase ya declarada en §0/§2. No aplica actualización de la Política de Privacidad ni de los formularios de tienda (el Vault no es alcanzable desde la app móvil en esta ronda — ver `PARIDAD.md` CZ7 — y no trata datos personales de empleados, solo credenciales de sistemas).

## 2. Terceros (procesadores) — verificado por `grep` de las edges (`supabase/functions/*`)

| Tercero | Para qué | Qué se le envía | Dónde en el código | País/región |
|---|---|---|---|---|
| **Supabase** (AWS) | Base de datos, archivos, auth, edge functions | Todo el dato de negocio | toda la app | EE. UU. (us-east-1) |
| **Vercel** | Hosting de la web | Peticiones web (sin dato en reposo) | despliegue web | EE. UU. / CDN global |
| **Resend** | **Correo transaccional** (avisos, informes) | Nombre y **correo** del destinatario + contenido del aviso | `api.resend.com` en 11 edges: `notificar-*`, `incentivo-*`, `generar-informe-obra`, `resumen-semanal-operaciones`, `check-domains`, `check-subscriptions` | EE. UU. |
| **Anthropic (Claude)** | **IA** — asistente "Compa", conector MCP, y lectura de recibos/cotizaciones/especificaciones de equipo/documentos de flota/documento de identidad del personal de obra/resúmenes de reportes de soporte (ronda DB) | Lo que el usuario escribe + datos de la empresa necesarios para responder; **foto del recibo/cotización**; **foto de "Información del sistema" de Windows** (dato personal ligero: nombre del equipo, cuenta de Windows con sesión iniciada — DA9, no se guarda la imagen salvo que el usuario la suba como foto "especificaciones"); **ronda DB (29-oct-2026):** fotos/PDF de documentos de VEHÍCULO (seguro/matrícula/marbete — solo campos extraídos, revisión humana por fila), **foto de la cédula/pasaporte del personal de obra + foto de la persona con el documento** (DB5 — la IA solo extrae los campos del alta y un veredicto cara↔documento; NO se guarda ninguna transcripción fuera de los campos del registro; las 2 fotos se guardan como las fotos tipadas de siempre del expediente), y el texto/fotos de reportes de Soporte para el resumen de ronda (DB6, solo admin/Tecnología) | `api.anthropic.com` en `assistant/index.ts:608`, `leer-recibo/index.ts:125`, `leer-cotizacion/index.ts`, `leer-especificaciones-equipo/index.ts` | EE. UU. |
| **Groq** | **IA** — transcripción de voz (principal) | **Audio** de la nota de voz | `api.groq.com` en `transcribe-now:38`, `transcribe-audio:25` | EE. UU. |
| **OpenAI** | **IA** — transcripción de voz (respaldo de Groq) | **Audio** de la nota de voz | `api.openai.com` en `transcribe-now:37`, `transcribe-audio:24` | EE. UU. |
| **Google — Firebase Cloud Messaging** | Notificaciones push | Token de push + contenido del aviso | `fcm.googleapis.com`, `oauth2.googleapis.com` en `send-push` | EE. UU. / global |
| **Google — Maps Platform** | Geocodificación inversa, lugares, rutas, "snap to roads", resolver enlaces de mapa | Coordenadas / texto de dirección / enlace de mapa | `maps.googleapis.com` (`reverse-geocode`, `routing-directions`), `places.googleapis.com` (`places-search`, `resolve-maps-link`), `roads.googleapis.com` (`snap-to-roads`) | EE. UU. / global |
| **Open-Meteo** | Clima de las obras | **Coordenadas** de la obra (sin dato personal) | `api.open-meteo.com`, `air-quality-api.open-meteo.com` en `sync-weather-obras` | UE (sin dato personal) |
| **OpenStreetMap — Nominatim** | Geocodificación (buscar dirección) | Texto de búsqueda / coordenadas | `nominatim.openstreetmap.org` en `src/shared/context/geocoding.service.ts:13` | UE |
| **Odoo 17** (ERP de la empresa, administrado por Chai Consultoría) | Fuente de verdad de inventario (PoC de **solo lectura**: stock, productos, ubicaciones) | Solo parámetros de consulta (término de búsqueda, IDs de producto/ubicación) y el JWT NO se reenvía; la cuenta técnica es del servidor. Se **reciben** nombres de producto/ubicación/almacén y cantidades (sin dato personal) | `supabase/functions/_shared/odoo-client.ts`, `odoo-api/` (XML-RPC `/xmlrpc/2/*`); secrets `ODOO_*`; caché efímera en memoria del isolate (TTL 15 s–10 min, no persiste) | Por confirmar con Chai Consultoría (hosting del ERP) |
| **RDAP** (`rdap.org`) | Herramienta interna de Tecnología (verificar dominios); **no procesa dato de empleados** | Nombre de dominio | `check-domains/index.ts:166` | — (herramienta interna) |

> **Mapas en la web:** hoy la web usa **Google Maps Platform** para las teselas/mapa (migración ya hecha; ya no se usan teselas OSM directas). OpenStreetMap queda solo como geocodificador (Nominatim). En la **app móvil** sí quedan teselas OSM (CI15 — higiene, PROMPT-87).

## 3. Conservación

| Dato | Conservación |
|---|---|
| Cuenta (usuario, cédula, cargo) | Mientras exista la relación laboral/contractual; al eliminar la cuenta se **anonimiza** (CI4), conservando los registros operativos/contables con el usuario como "Usuario eliminado" |
| Ubicación / rutas | Según necesidad operativa de flota (histórico de recorridos); revisable |
| Fotos / firmas / PDFs / audio | Mientras el registro de negocio los necesite (evidencia de obra/inventario/flota/RRHH) |
| Token de push / dispositivo | Mientras el dispositivo esté activo; se borran al eliminar la cuenta o al cerrar sesión |
| Registros contables (conduces, inventario, combustible) | Obligación legal/contable — se conservan aun tras anonimizar al usuario |
| Consentimientos / aceptaciones | Como prueba del permiso, mientras la cuenta exista |

## 4. Al tocar el código (recordatorio de la regla)

Si agregas una función que:
- **recoge un dato nuevo** (una columna/tabla/bucket con dato personal nuevo), o
- **llama a un tercero nuevo** (un host externo nuevo en una edge o en el front),

entonces: (1) **actualiza este documento** (fila en §1 o §2), y (2) **avisa en el reporte/HANDOFF** que *la Política de Privacidad y los formularios de Seguridad de datos (Play) / Privacidad de la app (Apple) deben revisarse* antes del próximo envío a tiendas.
