# COBERTURA-NOTAS — ronda BS (PROMPT-54, 17/09/2026)

Matriz de cobertura de la tanda BS. Las filas 1-35 (tandas previas) viven en
`C:\developer\improvements\septiembre 2026\imp 14092026\` (fuera del repo); aquí se
registran las filas **36-39 = esta tanda (BS1-BS4)** con Estado + ruta de pantalla,
y la **verificación de la ronda BR** que el prompt pidió tildar. Reglas A/B
(Xaviel, 15-sep): nada espera decisión — DEFAULT aplicado y reportado.

## Ronda BR — verificación en prod (por objeto)

| # | Apunte | Estado | Dónde |
|---|--------|--------|-------|
| BR1 | Combustible acepta-y-avisa (regla 15) | ✅ en prod | `registrar_combustible_app` (app); web `flota/combustible-log` chips KM ALERTA/SIN ASIGNACIÓN |
| BR2/BR3 | responsable_id + user-picker + puedeTransferir sin chofer | ✅ en prod | `salidas_inventario.responsable_id`; `inventario/requisiciones` (Aprobar), `shared/ui/user-picker` |
| BR4 | Rechazar recepción | ✅ en prod | `rechazar_recepcion`; `inventario/entradas` detalle (botón Rechazar) |
| BR5 | Comprar en ferretería desde requisición | ✅ en prod | `inventario/conduce-externo/nuevo?requisicion=` |
| BR6 | **Avisar a Logística** (botón de la app) | ✅ **aplicado** (commit `fcc2b24`) | RPC `sgc.combustible_avisar_revision(text,uuid)` → `notificar_modulo('flota','combustible_revisar',…)` |
| BR7 | Idioma del usuario (canónico) | ✅ en prod | `usuarios.idioma` + RPC `mi_idioma_set` (commit `fcc2b24`) |
| BO3 | Import proveedores fila-a-fila | ✅ en prod | `importar_proveedores`; `compras/proveedores` |
| BO8 | Requisiciones vencidas + calendario mensual | ✅ en prod | cron `sgc-requisiciones-vencidas`; `inventario/requisiciones` (vista Mes) |
| BO10 | Cartillas de acero v1 | ✅ en prod | tabla `cartillas`, bucket `sgc-cartillas`; `bitacora/cartillas` |
| — | Crons `sgc-vehiculos-sin-echada` / `sgc-requisiciones-vencidas` | ✅ en prod | `cron.job` |
| — | El Flaco (Encargado de Patio) | ✅ en prod | `usuarios` id `2fb18263…` |

## Ronda BS — esta tanda (filas 36-39)

| # | Nota | Estado | Ruta de pantalla / objeto | Notas |
|---|------|--------|---------------------------|-------|
| 36 | **BS1** — el almacén de despacho ofrece TODOS los que el rol lee, Central primero | ✅ CONSTRUIDO (build+guards verdes) | `inventario/requisiciones` (select "Almacén de despacho"); alineado `inventario/salidas` (origen) y `conduce-externo-form` | Regla 16 corolario. Coberturas n/N por opción (carga perezosa). RLS de `bodegas` ya permitía leer todas (`referencia autenticados`) → sin cambio de RLS. DEFAULT preselección: Central si cubre ≥1 renglón, si no la de la obra. |
| 37 | **BS2** — nada de lenguaje de desarrollador al usuario; causa de la cuenta de Raykler | ✅ CONSTRUIDO + causa diagnosticada | `shared/ui/error-state`, `friendly-error.util.presentarError`, `flota/vehiculos`, `flota/checklists`, `flota/responsabilidad`; guard `scripts/verify-dev-strings.mjs` | **Causa Raykler:** la RLS YA le concede Flota (módulo `flota` por 3 roles; `es_flota_elevado`). El "Tabla no configurada / Ejecuta el SQL en Supabase" era un banner que mapeaba cualquier `permission denied` a lenguaje de dev → eliminado. DEFAULT (guard=RLS): no se abrió RLS. Detalle técnico solo `esDesarrollador()`; todo error se reporta a `report_app_error`. |
| 38 | **BS3** — módulo Configuración (web), general para todos | ✅ CONSTRUIDO (migración validada, sin aplicar) | ruta `/configuracion` (authGuard, sin moduleGuard); `pages/configuracion`; shell engranaje; redirects `/perfil`→#cuenta, `/ajustes/notificaciones`→#notificaciones | Secciones: Cuenta (embebe Perfil), Idioma, Apariencia (claro/oscuro/sistema + densidad + tamaño), Notificaciones (embebe Ajustes), Inicio (módulo de arranque real), Sesión (edge `auth-signout-others`), Privacidad (choferes), Acerca. Migración `bs3-usuario-preferencias` (aditiva a la tabla existente BE6). RPCs `mis_preferencias`/`set_mi_preferencia` smoke OK (idioma canónico). |
| 39 | **BS4** — idioma fuera del PIN, en Configuración; diálogo de primer ingreso (web) | ✅ CONSTRUIDO (migración validada, sin aplicar) | `shared/i18n` (service+pipe), `shared/ui/language-selector`, `shared/ui/language-onboarding` (modal en shell); guard `scripts/verify-i18n.mjs` | i18n portado del hijo (csd-app) — 1ª vez que el hijo es referencia de infra (ver PARIDAD.md). Alcance v1 con `t()`: Configuración completa + error-state + language-selector; `en.json` (20+ claves), `ht.json` vacío. Diálogo de primer ingreso: bloqueante, preselección por navegador, sella `idioma_elegido_at`. Notificaciones i18n v1: `notif_tipo.titulo_i18n` + `notificar_modulo` localiza el título por destinatario (smoke OK: "Fuel entry to review"). App = PROMPT-55. |

**Ninguna fila espera decisión.**
