---
titulo: Política de Privacidad
version: 2026-10-07
vigencia: 7 de octubre de 2026
estado: borrador
---

> **BORRADOR técnico — pendiente de revisión legal.** Este texto fue redactado por el equipo de Tecnología a partir del inventario real de datos del sistema; **no constituye asesoría legal**. Será revisado y aprobado por el área legal de Constructora SD antes de su publicación definitiva.

## 1. Quién es el responsable

**Constructora SD** (en adelante, "la Empresa"), RNC **[[COMPLETAR: RNC]]**, con domicilio en **[[COMPLETAR: dirección]]**, República Dominicana, es la responsable del tratamiento de los datos personales que se recogen a través de la **CSD App** (aplicación móvil) y del sistema web **SGC** (en adelante, "la Aplicación").

Contacto en materia de privacidad: **tecnologia@constructorasd.com**.

La CSD App es una **herramienta interna de trabajo** para el personal, los conductores y los colaboradores de la Empresa. Las cuentas las crea la Empresa; **no existe registro público abierto**.

## 2. Qué datos recogemos y para qué

Tratamos únicamente los datos necesarios para la operación de la Empresa:

| Dato | Para qué lo usamos |
|---|---|
| Nombre, correo, teléfono, **cédula**, cargo y rol | Crear y administrar tu cuenta e identificarte en la operación |
| Contraseña / PIN | Inicio de sesión seguro |
| **Ubicación precisa** (de los conductores que comparten ubicación), **también cuando la app está cerrada o en segundo plano** | Que el área de Flota vea dónde está el vehículo y registrar las rutas de trabajo. **Se activa solo durante tu jornada** (ver sección 4) |
| Estado del conductor (disponible, en ruta, descanso, almuerzo, inactivo) | Controlar tu jornada y **encender o apagar** el registro de ubicación |
| Fotos (cámara/galería), firmas y documentos | Evidencias de obra, inventario, flota y recursos humanos |
| **Audio** (notas de voz) | Registrar incidentes y notas; se transcribe a texto (ver sección 3) |
| Identificadores del dispositivo, token de notificaciones, plataforma y versión | Enviarte notificaciones y dar soporte |
| Registros de error y diagnóstico | Resolver fallas técnicas |
| Datos biométricos (huella/rostro) | **Solo para desbloquear la app en tu teléfono. Nunca salen del dispositivo** ni se envían a la Empresa |

**Base del tratamiento:** la relación laboral o contractual entre tú y la Empresa, y el interés legítimo de la Empresa en administrar sus operaciones.

**No** recogemos datos con fines publicitarios, **no** rastreamos tu actividad en otras apps o sitios, y la Aplicación **no está dirigida a menores de edad**.

## 3. Funciones de inteligencia artificial (IA)

Algunas funciones envían datos a proveedores de IA de terceros, **solo si tú lo autorizas** la primera vez que las usas:

- **Asistente "Compa"** y **lectura de recibos**: usan **Anthropic (Claude)**. Se envía lo que escribes, la foto del recibo y los datos de la Empresa necesarios para responder.
- **Transcripción de notas de voz**: usa **Groq** (y **OpenAI** como respaldo). Se envía el audio de la nota.

Estos proveedores procesan los datos para dar el resultado y **no los usan para publicidad**. Puedes **otorgar o revocar** este permiso en *Perfil › Privacidad*. Si no lo otorgas, el resto de la Aplicación funciona igual (por ejemplo, la nota de voz se guarda sin transcribir).

## 4. Ubicación en segundo plano

La ubicación de los conductores que comparten ubicación se registra **también con la app cerrada o en segundo plano**, pero **solo mientras tu estado sea de trabajo** (Disponible, En ruta, Descanso, Almuerzo u Otros). **Se apaga** cuando marcas **Inactivo** o cierras sesión. Antes de activarla te mostramos un aviso claro y te pedimos permiso; puedes negarte.

## 5. Con quién se comparten los datos (proveedores)

Para operar, la Empresa usa proveedores de servicios ("procesadores") que tratan datos por cuenta de la Empresa. Varios están **fuera de la República Dominicana** (principalmente en Estados Unidos), lo que implica una **transferencia internacional** de datos:

- **Supabase** (EE. UU.) — base de datos, almacenamiento de archivos y autenticación.
- **Vercel** (EE. UU.) — alojamiento de la web.
- **Resend** (EE. UU.) — envío de correos (avisos e informes).
- **Anthropic** (EE. UU.) — IA del asistente y lectura de recibos.
- **Groq / OpenAI** (EE. UU.) — transcripción de notas de voz.
- **Google** (EE. UU./global) — notificaciones push (Firebase Cloud Messaging) y mapas (Google Maps Platform).
- **Open-Meteo** (UE) — clima de las obras (solo coordenadas, sin datos personales).
- **OpenStreetMap / Nominatim** (UE) — búsqueda de direcciones.

No vendemos tus datos ni los compartimos con terceros para fines distintos a los descritos.

## 6. Cuánto tiempo conservamos los datos

Conservamos los datos mientras exista tu relación con la Empresa y el tiempo necesario para las finalidades descritas. Los **registros operativos y contables** (conduces, inventario, combustible) se conservan por obligación legal y contable aun después de que elimines tu cuenta, pero con tu identidad **anonimizada** (ver sección 8).

## 7. Seguridad

Aplicamos medidas técnicas y organizativas razonables: cifrado en tránsito (HTTPS), control de acceso por roles, políticas de seguridad a nivel de base de datos y registro de auditoría. Ningún sistema es 100 % infalible, pero trabajamos para proteger tu información.

## 8. Tus derechos (Ley 172-13, República Dominicana)

Conforme a la **Ley No. 172-13** sobre protección de datos personales de la República Dominicana, tienes derecho a:

- **Acceder** a tus datos personales.
- **Rectificar** los datos inexactos.
- **Cancelar (eliminar)** tus datos cuando proceda.
- **Oponerte** a ciertos tratamientos.

Para ejercerlos, escribe a **tecnologia@constructorasd.com** o usa *Perfil › Privacidad › Solicitar eliminación de mi cuenta* en la Aplicación. También puedes solicitar la eliminación desde la página pública **[/politicas/eliminar-cuenta](/politicas/eliminar-cuenta)**. Atenderemos tu solicitud en un plazo **máximo de 30 días**. Ten en cuenta que algunos registros operativos/contables deben conservarse por obligación legal, con tu identidad anonimizada.

## 9. Menores

La Aplicación es una herramienta de trabajo para personal adulto de la Empresa y **no está dirigida a menores de 18 años**.

## 10. Cambios a esta política

Podemos actualizar esta política. Cuando el cambio sea relevante, subiremos el número de versión y te pediremos **aceptarla de nuevo** al iniciar sesión. La versión vigente siempre estará disponible en esta página.

---

## English summary (for store reviewers)

**Constructora SD** operates the **CSD App**, an **internal work tool** for its employees, drivers and collaborators (accounts are created by the company; there is no open public sign-up). The app processes: account data (name, email, phone, **national ID (cédula)**, job, role); **precise location — including in the background — for drivers who share it, only while their work status is active** (it turns off when the driver sets status to "Inactive" or logs out, after an explicit in-app disclosure and permission prompt); photos, signatures, documents; **voice notes (audio)**, which are transcribed; device identifiers and push tokens; and diagnostic logs. **Biometrics never leave the device.**

Certain features send data to **third-party AI** only **with the user's explicit consent** (revocable in *Profile › Privacy*): **Anthropic (Claude)** for the assistant and receipt reading, **Groq/OpenAI** for voice transcription. Other processors: **Supabase, Vercel, Resend, Google (FCM / Maps), Open-Meteo, OpenStreetMap** — several located in the USA (international transfer). We **do not** use data for advertising, **do not** track across apps/sites, and the app is **not directed to children**.

Users can **request account deletion** in-app (*Profile › Privacy*) or at **/politicas/eliminar-cuenta**; requests are handled within **30 days**, anonymizing the user while retaining operational/accounting records as legally required. Rights of access, rectification and cancellation apply under **Dominican Republic Law 172-13**. Contact: **tecnologia@constructorasd.com**.
