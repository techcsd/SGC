# Odoo: publicar en el chatter "como" un usuario real (investigación)

Fecha: 8-nov-2026. Aplica a Odoo 17.0+e (Enterprise) de Constructora SD. Reutilizable por cualquier integración que escriba en Odoo con una cuenta técnica (SGC, csd-app, n8n, etc.).

## 1. Qué controla qué
| Campo de `mail.message` | Quién lo fija | Se puede cambiar por API |
|---|---|---|
| `author_id` (autor visible, un `res.partner`) | parámetro `author_id` de `message_post` | **Sí** (probado) |
| `email_from` | parámetro `email_from` | Sí, y es obligatorio si el contacto no tiene correo |
| `create_uid` (quién lo creó) | el usuario que se autentica | **No**, salvo autenticándose como esa persona (clave de API propia) |

- Sin `email_from` y con un contacto sin correo, Odoo responde: "No se puede enviar el mensaje, configure la dirección de correo electrónico del remitente". Con `email_from` explícito funciona.
- El cuerpo que llega por RPC se escapa: un HTML se ve literal. Hay que enviar **texto plano**; Odoo lo guarda envuelto en `<p>`.
- Con `subtype_xmlid = mail.mt_note` (nota interna) no se generó ningún `mail.mail` ni `mail.notification`.

## 2. Pruebas reales (picking 871, traslado de prueba cancelado, 8-nov-2026)
1. Autor = contacto de prueba (proveedor 5432) con `email_from` explícito → autor visible 5432, `create_uid` = cuenta técnica. Sin `email_from` falló.
2. Código final (`resolverAutorOdoo` + texto plano + `vía SGC`) → autor = "Tecnología CSD" (contacto 5443), `create_uid` = Eduardo Ng (técnica), cuerpo `<p>Traslado … vía SGC …</p>`, 0 correos y 0 notificaciones.
3. Efectos permanentes en Odoo: picking `WH/INT/00119` cancelado + 2 notas de prueba (ids 99990 y 99991).

## 3. Cómo elegir el autor (orden de resolución)
1. Usuario **interno y activo** de Odoo cuyo `login` = correo del usuario SGC → su contacto (7 de 7 resueltos en lectura real).
2. Si no hay usuario: empleado (`hr.employee`) cuyo correo coincide → su `work_contact_id` (todos los 48 empleados lo tienen).
3. Si no hay nada: publicar con la cuenta técnica y el nombre real en el cuerpo.
Nunca usar un contacto cualquiera (proveedor/cliente) como autor. Siempre dejar "vía SGC" y el usuario real en el cuerpo: `create_uid` sigue siendo la cuenta técnica y la marca evita atribuir a alguien una acción que hizo el sistema.

## 4. ¿Hay que crear a todos los usuarios de SGC en Odoo?
No. Datos medidos (solo lectura):
- Odoo: 7 usuarios internos activos, 16 portal/público, 6 inactivos; 48 empleados (38 activos, solo 17 con correo; solo 2 vinculados a un usuario); 198 módulos instalados.
- SGC: 54 usuarios activos reales; 10 coinciden con un empleado por correo, 16 con un contacto, **38 no tienen ningún registro en Odoo**.

| Opción | Licencia | Veredicto |
|---|---|---|
| Usuario interno por cada persona | Sí, se factura por usuario interno activo | **No** |
| Usuario portal | No se factura (según fuentes de terceros) | Innecesario: no hace falta login |
| `hr.employee` | No requiere usuario | Reutilizar los 48 existentes (ya tienen contacto), no crear más |
| `res.partner` (contacto) con correo, etiquetado "Usuarios SGC" | No consume licencia | Solo para cubrir huecos si se quiere autor real para todos |
Recomendación: reutilizar usuario → empleado → (opcional) contacto etiquetado; nunca crear usuarios. Mejorar la cobertura cruzando por cédula (`identification_id` del empleado contra la cédula de SGC) en lugar de solo por correo.
**Verificado (8-nov-2026):** el contacto de trabajo de un empleado sin usuario funciona como `author_id`. Nota 99992 en el picking 871: autor "Edward Mota" (empleado, sin usuario en Odoo), `create_uid` = cuenta técnica, 0 correos y 0 notificaciones.
**Cruce por cédula** (solo lectura): Odoo tiene 43 de 48 empleados con cédula válida (11 dígitos), pero en SGC solo 15 de 54 usuarios tienen cédula resoluble (14 en `usuarios.cedula` y 1 vía `empleados`; `empleados` tiene solo 4 filas). Resultado: **10 de 54 coinciden por cédula, los mismos 10 que por correo**. La cédula no sube la cobertura mientras SGC no la capture; con las 54 cédulas, hasta 43 empleados podrían casar.
El código (`resolverAutorOdoo`) prueba en orden usuario interno por correo, empleado por cédula (con o sin guiones), empleado por correo, y cae a la cuenta técnica; si Odoo rechaza al autor reintenta una vez con la cuenta técnica y si no hay correo válido no manda `email_from`.
Sin verificar: la regla de licencias por escrito con Odoo (las fuentes son foros y guías de terceros, ver abajo).

## 5. Código (SGC)
`supabase/functions/_shared/odoo-traslados.ts`: `textoAuditoria` (texto plano), `remitenteAuditoria`, `resolverAutorOdoo`, `auditar`. `_shared/odoo-client.ts`: permiso de lectura `res.users.search_read`. Tests: 28 en `_shared/odoo-traslados.test.ts` (4 del autor).

## 6. Fuentes
- [How to post a message to chatter in Odoo 17 (Cybrosys)](https://cybrosys.com/blog/how-to-post-a-message-to-chatter-in-odoo-17)
- [Odoo 17 External API](https://www.odoo.com/documentation/17.0/developer/reference/external_api.html)
- [Foro Odoo: autor incorrecto al crear un mensaje por API](https://www.odoo.com/forum/help-1/creating-a-mail-message-record-displays-the-incorrect-author-id-using-the-api-php-182033)
- [Odoo Enterprise: licencias y cómo reducir costo (Ventor)](https://ventor.tech/odoo/odoo-enterprise-license-pricing-and-how-to-reduce-cost)
