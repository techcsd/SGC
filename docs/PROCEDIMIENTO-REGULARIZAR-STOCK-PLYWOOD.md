# Procedimiento — regularizar el stock real de plywood (y cualquier artículo sin existencia)

**Para:** Raykler (Almacén) · **Origen:** hotfix PROMPT-150 / DT2c · **Regla:** el stock real NO se corrige por script; se cuenta el material físico y se aplica por conteo.

## Por qué el plywood sale en 0
Las entradas históricas de plywood (p. ej. 500 en City Place el 4-nov) no dejaron existencia en los almacenes reales: hoy las filas de los 7 artículos CSD-02-014…020 están en **0** en cada almacén real. Los «3,000» que veía la web eran 1,000 en cada uno de 3 almacenes de **prueba** (ya excluidos del «Stock actual» desde la 1.218.5).

## Pasos (por almacén)
1. Cuenta el plywood físico (7 artículos: PLYWOOD FENOLICO 122X244, TIRA 61CM, TIRA 50 a 55CM, TIRA 35 a 45CM, TIRA 20CM a 30CM, COMPLETIVOS PEQUEÑOS, PEDAZOS GRANDES).
2. **App:** Inventario › Conteo → elige el almacén → escribe lo contado → Guardar. Espera a ver **«Enviado»** (si dice «Pendiente de sincronizar», conéctate a internet y toca *Reintentar*; el stock no cambia hasta que diga Enviado).
   **Web:** Inventario › Conteos y ajustes → nuevo conteo físico → cerrar → aprobar → aplicar (requiere el submódulo *Conteos* en «operar»).
3. Un artículo sin fila previa de stock **sí** se crea con el conteo: no hace falta darlo de alta antes.
4. Verifica en Inventario › Artículos que el «Stock actual» refleja lo contado, y en la app que ya aparece al atender una requisición.
5. Si algo falla, no reintentes en bucle: avisa a Tecnología con la hora y el almacén.

## Qué NO hacer
- No usar «Ajuste real» ni «Apertura» (son solo admin y no dejan traza de conteo).
- No pedirle a Tecnología que «cuadre» el stock por SQL.
