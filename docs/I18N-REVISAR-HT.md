# Kreyòl por revisar (DP-10/DP-14, CONTEXTO-72)

**Todo el `ht.json` es traducción generada por Claude, no validada por una
persona que hable Kreyòl ayisyen.** Antes de ofrecerlo a las cuadrillas,
alguien que hable Kreyòl debe revisar — en orden de prioridad — las pantallas
más vistas: login, inicio, conduce, bitácora, requisición, transporte (paso
físico 3 de `CONTEXTO-ACTUALIZACION-72.md`).

## Tanda 1 — módulo Claude (13-nov-2026, 123 claves)

Primer lote cableado (`claude`, `configuracion/claude`, `admin/claude`, ver
`docs/I18N-AVANCE.md`). No es de las pantallas más usadas por las cuadrillas,
pero es la primera traducción real y conviene validar el estilo/ortografía
antes de seguir generando lotes con el mismo criterio.

- Las 123 claves nuevas de `public/i18n/ht.json` correspondientes a
  `src/app/pages/claude/**`, `src/app/pages/configuracion/claude/**`,
  `src/app/pages/admin/claude/**`.
- Puntos a revisar en particular: ortografía OFÒ de términos técnicos nuevos
  («konektè», «demann materyèl», «bouyon» para "borrador"), y si «bouyon»
  (literalmente "borrador/bosquejo" de cocina) es la palabra correcta para
  "borrador" en este contexto de software o si existe un término mejor.

## Pendiente (se llena en cuanto esas pantallas se cableen)

- [ ] Login / autenticación
- [ ] Inicio / Dashboard
- [ ] Conduce
- [ ] Bitácora
- [ ] Requisición
- [ ] Transporte / apoyo de transporte

## Cómo se usa este archivo

Cada lote de F3/F4 que termine añade aquí su sección (módulo + fecha + nº de
claves + notas de términos dudosos). Cuando Xaviel consiga a alguien que
hable Kreyòl (paso físico 3), esa persona revisa tanda por tanda contra
`public/i18n/ht.json` y marca el checklist de arriba.

## Añadido en la ronda DR (16-nov-2026)
Se agregaron ~670 claves en `ht.json`. Las más visibles para que un hablante las
revise primero: «Cerrar sesión» (Dekonekte), «Hoy, en vivo», «Flota en vivo»,
textos del modo práctica (`MODO PRÁCTICA`, «Ya terminé», «Puedes mejorar») y los
errores amigables (permiso, sesión expirada, conexión). Siguen sin validar por
una persona.
