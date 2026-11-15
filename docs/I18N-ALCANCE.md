# Alcance de i18n (DP-14, CONTEXTO-72)

«100 %» en este repo significa **100 % de lo que mide `scripts/i18n-coverage.mjs`**:
texto en plantillas HTML (nodos de texto + atributos visibles) y literales en
`.ts` de las categorías que escanea (toasts/confirm/alert/placeholder/label/
titulo/mensaje). El número honesto vive en `docs/I18N-COVERAGE.md` y en
`src/shared/i18n/i18n-coverage.generated.ts` — nunca se declara 100 % a mano.

## SÍ se traduce (pasa por `t()` / `i18n.t()`)

- Toda la interfaz de la web: plantillas HTML (texto, `placeholder`,
  `aria-label`, `title`, `mat-label`, `alt`) y los textos de UI dentro de
  `.ts` (toasts, confirmaciones, errores, labels de formularios dinámicos).
- El selector de idioma, el onboarding de idioma y los textos de
  Configuración › Idioma.

## NO se traduce (por diseño, queda en español)

Estos textos **no cuentan** contra la cobertura y no deben envolverse en `t()`:

| Qué | Por qué |
|---|---|
| Catálogos de la base de datos (tipos de equipo, categorías, estados de catálogo) | Son datos de negocio, no copy de interfaz; viven en tablas, no en el código |
| Nombres de obra/proyecto/proveedor/artículo | Nombres propios reales de la operación de Constructora SD |
| Mensajes de negocio devueltos por RPC/edge functions (ej. errores de validación de dominio) | Los genera el servidor en español; traducirlos requeriría pasar el idioma del usuario a cada función y mantener catálogos en Postgres — fuera de alcance de esta ronda |
| Notificaciones push y correos transaccionales (Resend) | Contenido generado en el servidor, mismo motivo que arriba |
| PDFs generados en servidor (documentos, actas, plantillas rellenadas) | Documentos legales/administrativos; cambiarlos de idioma implicaría una plantilla por idioma |
| Respuestas de Compa/Claude (asistente conversacional) | Generadas por el modelo en tiempo real, no son copy estático |
| Contenido de las skills (biblioteca de Claude) | Contenido creado por usuarios/Tecnología, no interfaz |

## Calidad de la traducción por idioma

- **Español (`es`)**: idioma base — las claves de traducción SON el texto en
  español, así que siempre existe y nunca falla.
- **Inglés (`en`)**: traducción directa, inglés internacional neutro.
- **Kreyòl ayisyen (`ht`)**: generado por Claude siguiendo
  `docs/I18N-GLOSARIO.md`, **sin validar por un hablante nativo**. Los ~150
  textos más vistos (login, inicio, conduce, bitácora, requisición,
  transporte) están listados en `docs/I18N-REVISAR-HT.md` para que alguien
  que hable Kreyòl los revise antes de ofrecerlos a las cuadrillas (paso
  físico 3 de `CONTEXTO-ACTUALIZACION-72.md`).

## Cómo se amplía

1. Un texto nuevo de negocio/servidor que se decida traducir: agregar el
   parámetro de idioma a la función/RPC que lo genera y un catálogo propio
   (no pasa por `scripts/i18n-coverage.mjs`, que solo mide el cliente).
2. Un texto nuevo de interfaz: pasarlo por `t()`/`i18n.t()` igual que el
   resto — el escáner lo detecta solo la próxima vez que corra.
