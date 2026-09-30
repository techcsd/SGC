# `sql/_recuperadas/` — migraciones reconstruidas (CD10, regla 19)

Estas migraciones **se aplicaron a prod desde un scratchpad** y nunca quedaron en
`sql/` ni en el ledger (`sgc.migraciones_aplicadas`). Se detectaron en la ronda **CD**
(30-sep-2026) porque `sql/2026-08-29-combustible-enuso-web-paridad.sql:18-20` las cita
por nombre pero los archivos no existían en el repo — y una de ellas
(`2026-08-29-alinear-asignaciones-a-uso.sql`) es el **origen del bug CD3** (Edward Mota
con MT 03 pegado).

Están **reconstruidas por introspección de las definiciones vivas en prod** (triggers /
funciones) o, cuando eran DML puntual sin objeto persistente, por **reconstrucción de la
intención** a partir de la evidencia en la base. No son "la fuente de verdad original"
(esa se perdió); son la mejor reconstrucción fiel + trazabilidad.

**Regla 19 (nueva, madre):** ninguna escritura en prod — migración de esquema o
corrección de datos — vive fuera de `sql/` (o `scripts/data-fixes/` con fecha) y del
ledger. Nada desde el scratchpad. El guard `verify-regresiones` comprueba que todo
`sql/*.sql` citado en comentarios/docs existe en el repo.

| Archivo | Tipo | Estado en prod | Reconstruido de |
|---|---|---|---|
| `2026-08-29-un-uso-activo-por-chofer.sql` | trigger | ✅ vivo (`trg_uso_unico_por_chofer`) | `pg_get_functiondef` |
| `2026-08-29-alinear-asignaciones-a-uso.sql` | DML puntual | ✅ aplicado (34 asignaciones, 4 con nota "Alineada…") | intención (evidencia en `vehiculo_asignaciones`) |

> `2026-08-29-fuel-enuso-driver.sql` (también citado) vive en el repo hermano
> **`csd-app/sql/`** (misma BD compartida), no aquí — no es una migración perdida.
