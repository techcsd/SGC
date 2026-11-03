-- DH4 — Vault: "Responsable" se escribía a mano (texto libre); Xaviel pidió un
-- select de usuarios SGC. Columna nueva (no reemplaza `usuario_texto`, que sigue
-- siendo el usuario/login DEL SITIO externo — campos distintos).

alter table sgc.boveda_entradas
  add column if not exists responsable_id uuid references sgc.usuarios(id);
