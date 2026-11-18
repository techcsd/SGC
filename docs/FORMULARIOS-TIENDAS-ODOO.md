# Formularios de tienda — qué agregar por la integración con Odoo (#205)

Los llena una persona con acceso a Google Play Console y App Store Connect. Lo que cambia respecto a lo ya declarado:

**Google Play › Seguridad de datos**
- Datos compartidos con terceros: *Nombre* (de la persona que despacha o recibe un movimiento) → se comparte con el sistema contable de la empresa (Odoo) para el historial del movimiento.
- Finalidad: *Funcionalidad de la app* y *Administración de la cuenta/operación de la empresa*. No es publicidad ni análisis.
- Cifrado en tránsito: sí. El usuario puede pedir eliminación: sí (flujo existente de eliminar cuenta).
- Archivos: el PDF firmado del conduce (incluye firmas) se adjunta al movimiento en Odoo.

**App Store › Privacidad de la app**
- Tipos de datos vinculados a la identidad: *Nombre*, y *Contenido del usuario* (PDF firmado con firmas). Uso: *Funcionalidad de la app*. Sin seguimiento (tracking) entre apps.

Política de Privacidad: ya actualizada (§5). Inventario completo en `docs/DATOS-Y-TERCEROS.md`.
