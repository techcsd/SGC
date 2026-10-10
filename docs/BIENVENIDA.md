# BIENVENIDA (CL3) — onboarding web + app

Bienvenida corta (≈1 min), **siempre saltable**, por **rol**. No es un carrusel de
funciones (NN/g): personaliza (saludo por rol), explica lo no obvio y lleva al **tour con
foco** sobre los elementos reales. Flag **en servidor** por usuario → solo la ven los
usuarios nuevos.

## Flags y RPCs (servidor)
- `usuario_preferencias.bienvenida_web_v1_vista` / `.bienvenida_app_v2_vista` (timestamptz).
- `sgc.marcar_bienvenida_vista(p_canal)` — marca `web`|`app` para el usuario actual.
- `sgc.bienvenida_estado()` → `(web, app)` del usuario actual.
- Backfill: `scripts/data-fixes/2026-10-08-cl3-bienvenida-backfill.mjs` marca a los
  existentes como vistos (solo los nuevos la ven).
- Forzar en dev: `?bienvenida=1`. "Ver otra vez": Soporte (`verGuia`) y Dudas
  (`verBienvenida`) → `BienvenidaService.verOtraVez()`.

## Web — `shared/components/onboarding-web`
1. **Ventana central** (velo con desenfoque): chip de ROL + "Hola, {nombre}. Este es tu
   SGC." + tarjetas de módulos en abanico + "Mostrarme (3 pasos)" / "Ahora no".
2. **Tour con foco** (3 pasos, spotlight sobre el elemento real + tarjeta que explica):
   - **Menú** (`[data-tour="sidebar"]`) — texto por rol (su módulo principal).
   - **Avisos** (`.nav-badge`) — los números que requieren atención.
   - **¡Listo!** (centrado) — dónde volver a verla.
- Esc cierra, Tab recorre, foco en la ventana. reduce-motion = mismos pasos sin
  movimiento (sin scroll suave ni transición del spotlight).

## Pasos por rol (texto del 1.er paso del tour)
| Rol | Módulo | Qué resalta el texto |
|---|---|---|
| admin | Administración | usuarios, roles y configuración |
| direccion / gerencia | Dirección | indicadores y avance de proyectos |
| jefe_flota | Flota | vehículos, rutas, combustible, mantenimientos |
| logistica | Transporte | conduces, requisiciones, apoyo de transporte |
| abogado | Legal | expedientes, contratos, aprobaciones, firmas |
| rrhh | RRHH | empleados, asistencia, ausencias |
| ingeniero_campo / ingeniero_oficina | Obra | bitácora, requisiciones, personal de obra |
| encargado_almacen / bodeguero / encargado_patio | Inventario | entradas, salidas, conduces, conteos |
| chofer / chofer_privado | Transporte | rutas, conduces, combustible |
| (otro) | tu módulo | tu trabajo del día a día |

## App (PROMPT-93 — paridad)
Mismo contrato: flag `bienvenida_app_v2_vista`, mismos pasos por rol, 6 pantallas del
mock `CL3-bienvenida-app` (logo → idioma → saludo por rol → "sin señal" → permisos en
contexto + aceptación → "¡Todo listo!" → tour con foco). Detalle en `PARIDAD.md`.
