# Staging — dev ES el staging de SGC (CP5)

Pregunta de Xaviel: *"¿por qué no tenemos un staging? ¿o el entorno de dev hace lo
mismo?"* Respuesta: **dev ya ES el staging.** No hace falta un tercer entorno.

## 1. Dev es staging — la mecánica ya existe

Desde BU1 (regla 18), SGC tiene dos entornos con datos reales separados de los de
prueba: **prod** (`jeeqhgccqefbqilntcpu`, `sgcconstructorasd.com`) y **dev**
(`fzfrnrvndzrjwyvdpkgg` = `sgc-dev`, `dev.sgcconstructorasd.com`), este último con
un **clon anonimizado** del catálogo y la operación de prod. Esto es, por
definición, un staging: mismo esquema, datos representativos, URL pública propia,
acceso restringido. Toda la mecánica (cómo entrar, el flujo `feature/* → dev →
main`, el ledger de migraciones/edges/secrets, los rollbacks) está documentada en
**[`docs/ENTORNOS.md`](./ENTORNOS.md)** — este doc no la repite, solo la referencia.

Lo que faltaba no era el entorno: era la **disciplina** de usarlo como un gate real
antes de promover a prod. Eso es lo que este documento + `scripts/release-check.mjs`
cierran.

## 2. Qué faltaba y cómo se cierra

| Hueco | Antes | Ahora |
|---|---|---|
| Nada bloqueaba `dev → main` si una migración nunca se probó realmente en dev | El PR `dev → main` solo verificaba build + regla 18 de `apply-migration.mjs` (que exige ledger, pero nadie obligaba a *correr* el gate antes del PR) | `release-check.mjs` check 2: los `sql/*.sql` tocados recientemente deben estar en el ledger de dev **con el mismo checksum** |
| No había un registro humano de que alguien probó la versión específica antes de que saliera | Nada — "lo probé" quedaba solo en la memoria de Xaviel | `release-check.mjs` check 3: exige `qa/release-<version>.md` con el registro (quién, qué probó, resultado, fecha) |
| Nada exigía que los evals de Compa corrieran verdes antes de un deploy de la edge `assistant` | `scripts/compa-evals.mjs` existía pero nadie lo hacía correr obligatoriamente | `release-check.mjs` check 4: si `supabase/functions/assistant/index.ts` cambió, exige un reporte `qa/compa-evals-dev.json` fresco (<24h) y 100% verde |

Dos checks más completan el gate: que dev haya tenido tiempo de "respirar" (o un OK
explícito de Xaviel) y que el build + los tests sigan en verde. Ver la sección 3
para el detalle de los 5 checks.

## 3. Cómo usarlo desde hoy

Antes de **todo** PR `dev → main`, corre:

```
node scripts/release-check.mjs --env dev --version X.Y.Z
```

- `--env dev`: el entorno **auditado** (casi siempre `dev`, porque lo que se
  verifica es "¿dev ya vivió y probó esto?"). Sigue la convención de
  `scripts/lib/entorno.mjs` (`resolverEnv`) — sin `--env` no corre.
- `--version X.Y.Z`: la versión de `package.json` que se va a promover.
- `--yes`: evita la confirmación interactiva si corres con `--env prod` (no
  hace falta con `--env dev`, que nunca pide confirmación).
- `--skip-build`: salta el check 5 (build+tests) — **SOLO para depurar el propio
  `release-check.mjs`**, nunca para un release real (el build/tests es el check
  más importante de los 5 para que no se rompa prod).
- `--dias N` (default 14): ventana del heurístico "archivos tocados
  recientemente" (checks 2 y 4) cuando el repo no tiene tags de git (hoy no
  tiene ninguno). Si en el futuro se adoptan tags de versión, el script usa el
  último tag automáticamente en vez de la ventana de días.

El script imprime PASS/FAIL/SKIP por cada uno de los 5 checks y termina con
exit code 1 si alguno falló (nunca pasa en silencio):

1. **Dev respiró** (≥24h desde el último commit de la rama `dev`) **o** hay un OK
   explícito de Xaviel. Convención del OK: una línea que empiece con `OK:` o
   `**OK de Xaviel**` dentro de `qa/release-<version>.md`.
2. **Migraciones en el ledger**: los `sql/*.sql` tocados desde el último tag (o
   los últimos `--dias` días si no hay tags) deben existir en
   `sgc.migraciones_aplicadas` del entorno auditado con el checksum actual.
3. **Registro de prueba**: `qa/release-<version>.md` debe existir y no ser un
   stub. Forma esperada:
   ```
   # Release 1.191.0
   - Equipo/tester: <nombre>
   - Qué se probó: <flujo(s) ejercitados en dev.sgcconstructorasd.com>
   - Versión de origen (si se prueba una actualización): <X.Y.Z anterior>
   - Resultado: OK | FALLA (detalle)
   - Fecha: <YYYY-MM-DD>
   ```
4. **Evals de Compa**, solo si `supabase/functions/assistant/index.ts` cambió en
   la misma ventana (si no cambió, imprime `SKIP` explícito — nunca se omite sin
   decirlo): exige `qa/compa-evals-<entorno>.json` fresco (<24h) y 100% verde.
   Generarlo/refrescarlo con:
   ```
   node scripts/compa-evals.mjs --env dev
   ```
5. **Build + tests** (el check más lento, va último): `npm run build` (incluye
   todo el `prebuild`: guards + evals de Compa de código + `gen-version`) y, si
   existe, `npm run test:unit` (la variante sin `--watch` de `npm test`, para que
   el gate no quede colgado esperando un watcher).

Si todos los checks dan PASS/SKIP, el PR `dev → main` puede abrirse. Si alguno
da FAIL, el mensaje explica exactamente qué falta — no hay checks "silenciosos".

## 4. Refresco mensual del catálogo anonimizado de dev

Para que dev no se quede con artículos/obras/vehículos/bodegas viejos entre
corridas completas de `seed-dev.mjs` (que es pesado — reconstruye todo el esquema
incluyendo usuarios), hay un refresco liviano y específico de catálogo:

```
node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env dev --apply
```

Qué hace: lee de prod (solo lectura) `proyectos`, `bodegas`, `articulos` y
`vehiculos` con `es_prueba = false`, y los upsertea (por `id`) en dev, con estas
columnas **siempre anonimizadas/excluidas** (nunca se copian nombres, teléfonos,
FKs a personas, fotos, ni provenance de importación):

- Personas: `responsable_id`, `responsable_nombre`, `encargado_id`,
  `cerrado_por`, `ingeniero_obra(_id)`, `maestro_encargado`,
  `maestro_usuario_id`, `maestro_personal_id`, `contacto_nombre`,
  `contacto_telefono`, `km_base_combustible_por`.
- Fotos/imágenes: `fotos`, `foto_portada`, `imagen_url`.
- Provenance de import de prod: `importacion_id`.

Sin `--apply` es un dry-run de solo lectura (cuenta qué se copiaría). `--apply`
**solo corre con `--env dev`** — prod nunca es destino de escritura en este
script. Por decisión de Xaviel, la respuesta por defecto es **"sí, correrlo"**
una vez al mes; no hace falta pedir permiso cada vez, solo seguir el patrón
`--env dev --apply` de arriba.

## 5. Cinta visual — ya dice "Staging (dev)"

`src/shared/ui/entorno-badge/` pinta una cinta naranja fija en la esquina
superior cuando el entorno no es prod (más `[DEV]` en el `<title>` y favicon
naranja — ver `docs/ENTORNOS.md`). El texto de la cinta (`entorno-badge.html`)
ya se cambió de `DEV` a `Staging (dev)` — una vez que el trabajo concurrente en
esa misma rama terminó, no quedó conflicto.
