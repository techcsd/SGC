# Release 1.192.3

- Equipo/tester: Claude Code (sesión autónoma, login real en dev) + Xaviel
- Qué se probó: Esta vez con verificación real en navegador (Playwright headless, login
  real como tecnologia@constructorasd.com contra dev, no solo revisión de código):
  1. Xaviel reportó que la columna "Archivo de foto" en la plantilla no era una buena
     solución. Se rediseñó: se eliminó la columna; ahora las fotos se emparejan por el
     campo que ya identifica la fila (cédula del chofer, placa del vehículo), normalizado
     igual que el servidor (sin guiones/espacios/mayúsculas). Un archivo del .zip que no
     coincide con ninguna fila se reporta como "sin usar" — una fila sin foto YA NO se
     reporta como error (es normal, no todas necesitan foto).
  2. Se corrigió la plantilla descargable: traía 2 filas idénticas con "(obligatorio)"
     (bug de `[ejemplo, {...ejemplo}]`); ahora trae 1 sola fila.
  3. Se declaró el bucket `reuniones` en sql/ (bloqueaba el build: usado con upsert:true
     desde csd-app — trabajo no relacionado de otra sesión — pero el auditor cruzado
     BM2 rompe el build de AMBOS repos hasta declararlo).
  4. **Verificación real en dev**: login headless, Flota→Conductores→Importar (sin
     tarjetas, un solo camino — correcto), descarga de plantilla (1 fila, sin columna de
     foto — correcto), subida de Excel + .zip con 1 foto nombrada con la cédula de
     prueba → 1 nueva, 0 errores, 1 foto subida → ficha del conductor muestra la foto
     (no iniciales). Flota→Vehículos→Importar: 2 tarjetas visibles, click en "Archivo de
     Odoo" cambia el contenido mostrado, plantilla de 1 fila sin columna de foto, import
     de un vehículo SIN año no da error (cae al año actual). 13/13 verificaciones en
     verde. Datos de prueba eliminados de dev al terminar.
- Versión de origen: 1.192.2
- Resultado: OK — primera vez que esta función se prueba de punta a punta con navegador real.
- Fecha: 2026-10-16

**OK de Xaviel**: pidió explícitamente "find a better way" para la columna de foto y "try
it, in order to try if all works fine"; autorizó el reset de contraseña de QA en dev para
poder hacerlo (2026-10-16).
