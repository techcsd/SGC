# QA — PoC "Stock en Odoo" (solo lectura) — PR #22

Para: Xaviel / Tecnología (validación en `dev.sgcconstructorasd.com` antes de promover a `main`).
Qué es: pantalla **Inventario › Stock en Odoo** (`/inventario/stock-odoo`) que lee existencias **en vivo** de Odoo 17 vía la edge `odoo-api` (pantalla → servicio → edge → Odoo por XML-RPC). **Solo lectura**: sin migraciones, sin tablas espejo, sin cola, sin fallback a `stock_por_bodega`, sin escrituras en Odoo.
Plan mayor (fases de migración del inventario a Odoo): issue #20 y notas de análisis; este PR no cambia ningún servicio ni tabla existente.

## 1. Qué se desplegó en dev
| Pieza | Estado en sgc-dev (`fzfrnrvndzrjwyvdpkgg`) |
|---|---|
| Edge `odoo-api` | desplegada con `deploy-edge.mjs --env dev` (v11 al 25-oct), `verify_jwt = true` |
| Secrets | `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY`, `ODOO_COMPANY_ID=1` (aplicados con `aplicar-secret.mjs --env dev`; valores nunca impresos) |
| Instancia Odoo | `scheker.chaiconsultoria.com`, base `scheker.chaiconsultoria.com`, compañía 1. **Es producción de Odoo** (no hay base de pruebas) |
| Cuenta técnica | usuario "VISITANTE AUTORIZADO" (perfil `ODOO_LIMITED_*` en Doppler) |
| Prod (Supabase) | **nada**: ni la edge ni los secrets |

Variables opcionales de la edge: `ODOO_CACHE_TTL_S_<ACCION>` (p. ej. `ODOO_CACHE_TTL_S_STOCK_CONSULTAR`, segundos; `0` = sin caché) y `ODOO_CORS_ORIGINS` (lista separada por comas; por defecto prod, dev, app-dev y `localhost:4200`).
TTL por defecto: ubicaciones 10 min · productos 60 s · stock 15 s.

## 2. Usuarios de prueba en dev
- `qa-odoo-con@dev.constructorasd.local` — rol `encargado_patio` (**con** módulo `inventario`).
- `qa-odoo-sin@dev.constructorasd.local` — rol `capataz` (**sin** módulo `inventario`).
- Ambos están en `sgc.dev_acceso`. La contraseña está en Doppler (proyecto `amp`, config `dev`, variable `SGC_DEV_QA_ODOO_PASSWORD`); si no tienes acceso a Doppler, fija una nueva con `node scripts/dev-set-password.mjs --env dev --email <correo> --password "<clave>"` o usa "Entrar como…" en Admin › Usuarios de prueba.
- Al primer ingreso aparecen los modales de políticas y de "Novedades"; hay que aceptarlos/cerrarlos para ver la pantalla.
- También sirve cualquier usuario real de dev con el módulo `inventario` (o admin).

## 3. Casos de prueba
Marca ☐ → ✅/❌ y anota observaciones en la sección 6.

| # | Caso | Pasos | Esperado | OK |
|---|---|---|---|---|
| Q1 | Acceso con módulo | Entrar como `qa-odoo-con` → menú Inventario | Aparece **Stock en Odoo**; la ruta abre sin 403 | ☐ |
| Q2 | Carga inicial | Abrir `/inventario/stock-odoo` | Selector de ubicaciones poblado (~23 ubicaciones `*/Existencias`, `WH/Almacén principal`) y tabla de 25 filas con cantidad física / reservada / disponible; texto "Consultado a las HH:MM:SS" | ☐ |
| Q3 | Filtro por ubicación | Elegir una ubicación | La tabla solo muestra esa ubicación (y sus hijas) | ☐ |
| Q4 | Buscador de producto | Escribir `cem` despacio y luego rápido | Un solo pedido tras ~300 ms; lista de sugerencias; con teclado: ↓/↑ resalta, Enter elige, Esc cierra; al elegir se filtra la tabla | ☐ |
| Q5 | Producto de prueba | Buscar `ZZ-PRUEBA-SGC` y elegirlo | Aparece `ZZ-PRUEBA-SGC-PoC-NO-USAR-2026-10-25`; la tabla dice "No hay existencias para este filtro." (no tiene stock) | ☐ |
| Q6 | Quitar/editar filtro | Con un producto elegido, editar el texto o pulsar la X | El filtro de producto se limpia y la tabla vuelve a todo el stock | ☐ |
| Q7 | Paginación | Pulsar Siguiente / Anterior | Cambia de página; "Siguiente" deshabilitado en la última; sin saltos ni repetidos entre páginas | ☐ |
| Q8 | Caché y "Actualizar" | Consultar dos veces seguidas; luego pulsar Actualizar | La segunda marca "desde caché" con la misma hora; Actualizar trae una hora nueva | ☐ |
| Q9 | Sin módulo (UI) | Entrar como `qa-odoo-sin` y abrir la URL directa | Redirige a 403; la entrada no aparece en el menú | ☐ |
| Q10 | Sin módulo (servidor) | `curl` de la sección 4 con el JWT de `qa-odoo-sin` | HTTP 403 `{"error":"Tu rol no tiene acceso a esta información."}` | ☐ |
| Q11 | Sin JWT / acción libre | `curl` sin `Authorization`; con acción `execute_kw` | 401 · 400 "Acción no permitida." | ☐ |
| Q12 | Odoo caído | En Dashboard → Edge Functions → Secrets de sgc-dev poner `ODOO_URL=https://odoo-caido.invalid` y redesplegar `odoo-api`; abrir la pantalla | Mensaje "No pudimos cargar el stock de Odoo. Ya se reportó a Tecnología." + Reintentar; **nunca** datos locales; un desarrollador ve el detalle técnico `[odoo_no_disponible]`. **Restaurar el secret al terminar** | ☐ |
| Q13 | Cambio directo en Odoo | Una persona hace un ajuste de inventario en Odoo sobre un producto y luego, en la pantalla, pulsa **Actualizar** (o espera 15 s) | La cantidad nueva aparece sin sincronizar nada. Referencia: el 23→25-oct el producto 816 pasó de CITY 10 / RIVI 5 / WH 3 a CITY 12 / RIVI 6 / sin WH por movimientos reales | ☐ |
| Q14 | Cantidad reservada | Elegir un producto con una reserva real en Odoo | La columna "Reservada" muestra la cantidad y "Disponible" = física − reservada. **No se ha podido ejercitar**: en todo lo observado vale 0 | ☐ |
| Q15 | Idioma | Cambiar el idioma del usuario a inglés | "Stock in Odoo", "On-hand quantity", "Reserved", etc.; mensajes de error traducidos | ☐ |
| Q16 | Responsive y a11y | Viewport 375 px y navegación solo con teclado | Sin desbordes ni huecos; foco visible; el buscador se anuncia como combobox | ☐ |
| Q17 | Límite por usuario (opcional) | Más de 60 consultas en 1 minuto | HTTP 429 con `Retry-After` | ☐ |

## 4. `curl` de apoyo (dev)
```bash
R=fzfrnrvndzrjwyvdpkgg                       # sgc-dev
ANON='<anon key de dev, la de environment.dev.ts>'
JWT=$(curl -s -X POST "https://$R.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"email":"qa-odoo-sin@dev.constructorasd.local","password":"<clave>"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
curl -s -w ' [HTTP %{http_code}]\n' -X POST "https://$R.supabase.co/functions/v1/odoo-api" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"accion":"stock.consultar","params":{"producto_id":816}}'
```
Acciones válidas: `productos.buscar {termino, limite≤50}`, `ubicaciones.listar`, `stock.consultar {producto_id?, ubicacion_id?, pagina≤200, tamano≤100}`; cualquier parámetro `refrescar:true` salta la caché.

## 5. Ya verificado antes de este QA (no hace falta repetir, sí contrastar)
- `npm run build` ✓ · `npm test` 110/110 ✓ · `npm run test:edge-odoo` (Deno) 30/30 ✓.
- Stock de 4 productos de la edge de dev == lectura independiente por `search_read` en Odoo (25-oct): 835 → WH 25 · 821 → TA 20, WH 10 · 830 → WH 15 · 816 → CITY 12, RIVI 6, TA 22.
- Caché: miss → hit → refresh; 6 peticiones simultáneas = una sola carga a Odoo (mismo `consultado_en`).
- `qa-odoo-sin` → 403; sin JWT → 401; acción fuera de la allowlist → 400; `ODOO_URL` inválida → 502 `odoo_no_disponible`; sin secrets → 500 `odoo_config` genérico; timeout del gateway local → 504 a los ~15,6 s.
- Un `%` o `_` escrito en el buscador ya no actúa como comodín (Odoo no los escapa; la edge sí).
- Producto de prueba creado en Odoo con un script puntual fuera del repo: `ZZ-PRUEBA-SGC-PoC-NO-USAR-2026-10-25`, **template 1454 / variante 1439**, almacenable, compañía 1, sin proveedor ni precio. Apareció en `productos.buscar` y en el buscador sin sincronizar.

## 6. Registro de QA (llenar)
- Tester: ____________  Fecha: ____________  Navegador/dispositivo: ____________
- Resultado general: ☐ OK para promover ☐ con observaciones ☐ rechazado
- Observaciones por caso:

## 7. Riesgos y condiciones antes de ir a `main`
1. **La cuenta técnica de Odoo (`ODOO_LIMITED_*`) NO es de solo lectura.** Verificado con `check_access_rights`: puede crear/escribir/borrar en `product.*`, `stock.picking`, `purchase.order`, `res.partner` e incluso `ir.rule`. El código no tiene ninguna ruta de escritura (allowlist de 3 lecturas), pero la credencial sí podría. **No debe subir a prod**: pedir a Chai Consultoría un usuario técnico de solo lectura sobre `stock.quant`, `stock.location` y `product.product`.
2. **Prod**: subir los 5 secrets `ODOO_*` y desplegar `odoo-api` con `--env prod` (la regla 18 lo permite porque ya está en el ledger de dev). Mientras no se haga, en prod la pantalla mostraría el error traducido a quien tenga el módulo `inventario`.
3. **Versión / gate** (PR `dev → main`): bump de versión, entrada en `release-notes.json`, `qa/release-<versión>.md` y `node scripts/release-check.mjs --env dev --version X.Y.Z`. No están en este PR.
4. El gateway es compartido entre isolates solo por acceso a Odoo: la caché es **por isolate** (memoria efímera). Con mucho tráfico repartido el acierto baja; si importa, el siguiente paso es una caché compartida (KV/tabla `UNLOGGED`). Medir antes de decidir.
5. El stock de Odoo **no refleja los movimientos hechos en SGC** hasta que se corte el cluster de despacho (fase 3 del plan). No usar esta pantalla para decidir despachos todavía.
6. Hallazgos previos a la PoC (CORS `*` en 39 edges, `capacidades_asistente` con módulos fijos, `npm run build` falla en un worktree limpio, edges sin CI de tipos/tests): issue #21.

## 8. Rollback
- Front: revertir el merge (la ruta y la entrada del shell desaparecen; no hay migraciones ni datos que deshacer).
- Edge: en dev se puede borrar `odoo-api` y los 5 secrets `ODOO_*` desde el Dashboard; en prod no hay nada desplegado.
- Odoo: **archivar** el producto de prueba (template 1454): Inventario › Productos › abrir `ZZ-PRUEBA-SGC-PoC-NO-USAR-2026-10-25` › Acción › Archivar (o `active=False`). No se borró. Archivado desaparece de `productos.buscar` (la edge filtra `active = true`).
- Limpieza de dev opcional: quitar a `qa-odoo-con` / `qa-odoo-sin` de `sgc.dev_acceso` y desactivarlos.
