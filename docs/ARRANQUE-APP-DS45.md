# Arranque de la app: qué debe leer (DS-45, #69)

Para PROMPT-149 (csd-app / web). Todo está en **dev**; nada en prod.

## Una sola llamada al abrir: `sgc.mi_arranque()`
RPC `SECURITY INVOKER` (permisos de quien llama; `anon` no puede). Devuelve:

| Campo | Qué es | Reemplaza |
|---|---|---|
| `preferencias` | jsonb de `mis_preferencias()` (idioma, tema, densidad, tamaño de letra, módulo de inicio, Compa flotante) | `mis_preferencias` |
| `firmas_pendientes` | cantidad (no el detalle) | `mis_firmas_pendientes` (solo para el badge) |
| `entregas_por_confirmar` | cantidad | `mis_entregas_por_confirmar` (solo para el badge) |
| `generado_en` | `now()` del servidor | — |

Las RPC originales siguen existiendo y son la fuente del detalle: pedirlas **solo al abrir la pantalla** que las muestra, no en el arranque.
Medido en dev (admin): `mis_preferencias` 0,7 ms, `mis_firmas_pendientes` 1,2 ms, `mis_entregas_por_confirmar` 19,6 ms (en prod 76/30/158 ms según el análisis del 01-nov).

## Zonas horarias: leer `sgc.zonas_horarias`, no `pg_timezone_names`
- Tabla `sgc.zonas_horarias(nombre text pk, abreviatura text, utc_offset interval)`: 1196 filas, lectura `authenticated`, RLS.
- `pg_timezone_names` es una vista de catálogo que Postgres reconstruye en cada consulta (lenta). No se usa en `src/` ni en las edges: la llamada viene de la app móvil o de un cliente externo, que debe cambiar a:
  `supabase.schema('sgc').from('zonas_horarias').select('nombre, abreviatura, utc_offset').order('nombre')`
- Cachear en el cliente (la lista cambia casi nunca; vigencia sugerida 24 h o hasta nueva versión de la app).
- Refresco: `select sgc.zonas_horarias_refrescar()` (service_role / admin) tras actualizar Postgres.

## Pendiente de la app (no se puede hacer desde este repo)
1. Llamar `mi_arranque()` en vez de las tres RPC y cachear su resultado en memoria durante la sesión.
2. Cambiar la lectura de zonas horarias a la tabla.
3. Instrumentar `/auth/pin` y `/home` (tiempos por RPC) para confirmar con datos de prod si quedan timeouts (DS-42).
