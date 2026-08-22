-- AU13 — Unidades. En la WEB el formulario de artículo YA usa el catálogo `sgc.unidades`
-- como desplegable (guarda el `codigo`), y el catálogo ya trae m², quintal, m³ (AQ3).
-- Lo que faltaba: algunas unidades legítimas usadas a mano no existían en el catálogo,
-- así que el desplegable no las ofrecía y la data legacy quedó como texto libre.
-- Aditivo: agrega las que faltan. La HOMOLOGACIÓN de la data legacy va en un archivo
-- aparte (au13-unidades-homologacion) que se aplica tras la confirmación de Xaviel.

insert into sgc.unidades (codigo, nombre, activo) values
  ('paquete', 'Paquete', true),
  ('resma',   'Resma',   true),
  ('juego',   'Juego',   true)
on conflict (codigo) do nothing;
