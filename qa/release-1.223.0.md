# Release 1.223.0 (ronda EA: proveedores de Tecnología, cédulas con IA, logo, Dev notes y carril del Ingeniero)
- Equipo/tester: Claude Code (sesión asistida) con usuario QA de dev y credenciales de integración.
- Qué cambia: migraciones ea1/ea1b/ea2/ea3/ea4 (proveedores Tec, conector, lectura de cédulas en lote, cola del Ingeniero, logo de empresa), edges `leer-cedulas-lote`, `agente-ingeniero-cola`, `agente-ingeniero-despachar`, `agente-cronista`, `assistant`, `mcp`, `claude-borrador`, y los workflows/guardianes de los agentes.
- Qué se probó: las 5 migraciones aplicadas en dev y luego en prod con ledger (checksums iguales); edges desplegadas a dev y luego a prod; la app 2.73.x (que consume estos objetos) corrió en dev y prod; el workflow `agente-ingeniero` de csd-app resolvió el reutilizable de SGC y llegó a leer la tarea.
- NO probado: la pantalla web de Proveedores Tec y la lectura de cédulas en lote en navegador; una tarea real del Ingeniero de punta a punta (se hace tras el release con un uuid de prueba).
- Versión de origen: 1.222.5
- Resultado: OK
- Fecha: 2026-11-26
**OK de Xaviel** 2026-11-26: «haz el release de SGC a main» (release 1.223.0 a prod; antes: «tienes mi OK para todo»).
- [x] Build y tests
Probado por: Claude Code (sesión asistida) · 2026-11-26
