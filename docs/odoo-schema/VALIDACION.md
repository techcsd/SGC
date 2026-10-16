# Validación local del paquete — 16/10/2026

Estado: preparado y probado localmente. No aplicado a Supabase dev/prod; no ejecuta acciones en Odoo.

Entorno de prueba: PostgreSQL 16.14 (Homebrew), clúster temporal con socket privado y sin listener TCP. El destino Supabase del catálogo consultado previamente es PostgreSQL 17; requiere prueba posterior en dev.

## Comprobaciones ejecutadas

- `bash qa/odoo-schema/run.sh`: PASS.
- Fase mínima aislada: 61 columnas opcionales sin default, 2 tablas de contexto, sin cola; permisos y verificación específica correctos. Reaplicación idéntica: PASS.
- Ampliación desde la fase mínima: 63 comprobaciones correctas.
- Instalación completa directa y reaplicación idéntica: 63 comprobaciones correctas.
- Dos consumidores SQL concurrentes: obtuvieron eventos distintos sin reclamar el mismo evento.
- Preflight, verificación, validación posterior de restricciones: PASS.
- Compatibilidad representativa: se conservaron tipos/columnas y grants anteriores, escritura de campos legacy y `odoo_ref`, cascadas de borrado previas y snapshots de vínculos. DELETE de unidad con padre histórico desfasado también permitido; desfase detectable para bloquear su reutilización.
- `node scripts/audit-notnull-sin-default.mjs`: PASS.
- `node scripts/audit-rpc-grants.mjs`: PASS; 526 RPC del cliente con grant en SQL versionado.
- Revisión independiente de SQL y documentación: sin P1/P2 pendientes en la revisión final.

## Alcance de la evidencia

La fixture reproduce tipos y columnas relevantes de 20 tablas según el catálogo dev capturado el 15/10/2026. No copia filas reales, ni reproduce todos los RPC, RLS, consumidores externos o flujos de la aplicación. La prueba local no acredita compatibilidad completa del entorno desplegado.

Antes de aplicar/promover: ejecutar preflight actual, aplicar primero en dev con el ledger del repositorio y probar los flujos/perfiles reales indicados en README. El paquete no instala worker, captura de cambios ni integración HTTP; no habilita conexiones ni sincroniza existencias.

## SHA-256 de migraciones

- `sql/20261016112524_odoo_identity_fields.sql`: `af0ae63e7ec6d3724c686e7a4dc79cc615ccb3d92e070506abb3496656c63025`
- `sql/20261016112525_odoo_sync_foundation.sql`: `c91080986230212fb0c77e063c6bebaca8e17c7c5d77347e56c869eaf532f657`

El archivo `SHA256SUMS` incluye también documentación y QA. Los checksums describen los archivos entregados; no indican que se hayan aplicado remotamente.
