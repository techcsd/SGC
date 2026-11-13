# Ficha — tablero "Organigrama v2" (Claude Design)

Ronda DO (12-nov-2026), DO3/DO-04. El dato y la estructura de árbol ya están resueltos en código
(`organigrama.ts`, `sgc.rrhh_organigrama()`); el HTML ya es un marcado anidado real (`<li>` → `<ul class="og-nodo__hijos">`
→ `<li>` hijo, con un hueco `.og-nodo__conector` listo para una línea de conexión). **Falta solo el diseño visual** —
colores, tarjetas, líneas de conector — que debe salir de un tablero aprobado, no improvisado en código.

Pantalla: `RRHH › Organigrama` (`/rrhh/organigrama`).

## Estados a mockear

1. **Jerarquía profunda (3+ niveles).** Ej.: Gerencia → Jefe de obra → Capataz → Ayudante. El diseño debe
   dejar claro quién reporta a quién sin que el nivel 3-4 se pierda visualmente (líneas de conexión, sangría,
   o tarjetas conectadas — a elección del diseño).
2. **Empleados huérfanos (sin jefe asignado).** Hoy aparecen como raíz adicional junto al resto del árbol,
   con un aviso de texto arriba ("Algunos empleados no tienen jefe asignado..."). El tablero debe decidir
   cómo distinguirlos visualmente de las raíces reales (¿sección aparte? ¿badge? ¿agrupador "Sin jefe"?).
3. **Empleados inactivos dentro del árbol.** Hoy llevan un badge "inactivo" gris. Deben seguir siendo
   visibles en su lugar en la jerarquía (no se ocultan), pero visualmente atenuados/diferenciados del resto.

## Lo que el código ya entrega (no se repite en el diseño)

- Nodo: nombre + apellido, cargo (si existe), badge inactivo (si aplica).
- Agrupado y orden ya resueltos en servidor + cliente (jefe antes que reportes, sin ciclos).
- Clases estructurales ya existentes para engancharse: `.og-arbol` (raíz), `.og-nodo` (un nodo completo),
  `.og-nodo__card` (la tarjeta visual de ese nodo), `.og-nodo__conector` (hueco para la línea, hoy vacío/oculto),
  `.og-nodo__hijos` (la lista de hijos de un nodo).

## Lo que el tablero debe definir

- Estilo de tarjeta por nodo (color, tipografía, iconografía por cargo/departamento si aplica).
- Estilo de línea/conector entre jefe e hijos (recto, curvo, con flecha, etc.).
- Tratamiento visual de huérfanos e inactivos (ver estados arriba).
- Comportamiento responsive (la jerarquía puede ser ancha en niveles bajos — ¿scroll horizontal? ¿colapsar ramas?).

## Pasos físicos de Xaviel

Aprobar (o pedirle a Cowork) el tablero "Organigrama v2" en Claude Design usando esta ficha antes de que
se escriba el CSS final — el marcado ya está listo para recibirlo sin volver a tocar el template.
