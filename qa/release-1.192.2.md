# Release 1.192.2

- Equipo/tester: Claude Code (sesión autónoma) + Xaviel
- Qué se probó: Xaviel pidió, tras ver 1.192.1 en prod, que el paso "Sube el archivo" muestre
  las dos opciones (Plantilla SGC / Archivo de Odoo) como dos tarjetas en la misma pantalla en
  vez de un botón + una sección colapsada aparte — más fácil de entender de un vistazo.
  Implementado: dos tarjetas clicables ("Plantilla SGC" marcada "Recomendado" y "Archivo de
  Odoo") solo para entidades con perfil Odoo (vehículos/proveedores/artículos); al hacer clic
  en una tarjeta se muestra su contenido (descargar plantilla, o instrucciones de exportación
  de Odoo). Un único botón "Elegir archivo" debajo de ambas — el sistema ya detecta solo el
  formato por los encabezados de columna, sin importar cuál tarjeta se vio. Choferes (sin
  perfil Odoo) sigue mostrando un solo camino, sin tarjetas que elegir.
  No se pudo verificar visualmente con navegador real en esta sesión (sesión de QA guardada
  expirada, sin credenciales de login de dev) — se revisó el template/estilos manualmente y
  `npm run build` (con todos los guards del prebuild) salió verde.
- Versión de origen: 1.192.1
- Resultado: OK con la misma salvedad de verificación visual pendiente que 1.192.0/1.192.1.
- Fecha: 2026-10-16

**OK de Xaviel**: pidió el cambio directamente y aprobó el diseño eligiendo la opción
"2 tarjetas arriba + 1 solo botón de subir abajo" entre las presentadas (2026-10-16).
