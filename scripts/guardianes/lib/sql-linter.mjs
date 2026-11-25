// G1 — linter de SQL ADITIVO. Prohíbe lo destructivo; marca como zona roja lo que cambia RLS/permisos.
export function limpiarSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''"); // literales de texto fuera (evita falsos positivos)
}

const PROHIBIDO = [
  { id: 'drop', re: /\bdrop\s+(?:table|column|schema|function|policy|view|materialized|index|trigger|type|constraint|extension|role|sequence|database|publication|rule|domain|aggregate)\b/, detalle: 'DROP prohibido: las migraciones del agente son solo aditivas.' },
  { id: 'truncate', re: /\btruncate\b/, detalle: 'TRUNCATE prohibido.' },
  { id: 'alter_column_type', re: /\balter\s+column\b[^;]*?\btype\b/, detalle: 'ALTER COLUMN ... TYPE prohibido (reescribe/rompe datos).' },
  { id: 'disable_rls', re: /\b(?:disable|no\s+force)\s+row\s+level\s+security\b/, detalle: 'Desactivar RLS prohibido.' },
  { id: 'grant_anon', re: /\bgrant\b[^;]*\bto\b[^;]*\b(?:anon|public)\b/, detalle: 'GRANT a anon/public prohibido.' },
];
const ZONA_ROJA = [
  { id: 'policy', re: /\b(?:create|alter|drop)\s+policy\b/, detalle: 'Cambia políticas RLS.' },
  { id: 'rls_enable', re: /\b(?:enable|force)\s+row\s+level\s+security\b/, detalle: 'Cambia el estado de RLS.' },
  { id: 'grant_revoke', re: /\b(?:grant|revoke)\b/, detalle: 'Cambia permisos (GRANT/REVOKE).' },
  { id: 'roles', re: /\b(?:create|alter|drop)\s+(?:role|user)\b|\balter\s+default\s+privileges\b/, detalle: 'Cambia roles de base de datos.' },
  { id: 'tabla_roles_sgc', re: /\bsgc\.(?:roles|usuarios_roles|permisos)\b|\bmodulos\b[^;]*\barray_append\b/, detalle: 'Toca roles/permisos de la aplicación.' },
  { id: 'security_definer', re: /\bsecurity\s+definer\b/, detalle: 'Función SECURITY DEFINER (salta RLS).' },
  { id: 'schema_auth', re: /\bauth\.\w+/, detalle: 'Toca el esquema auth.' },
];

export function analizarSql(sql) {
  const limpio = limpiarSql(sql).toLowerCase().replace(/\s+/g, ' ');
  const sentencias = limpio.split(';').map((s) => s.trim()).filter(Boolean);
  const errores = [];
  const zonaRoja = [];
  const avisos = [];
  const marca = (arr, o) => { if (!arr.some((x) => x.id === o.id)) arr.push({ id: o.id, detalle: o.detalle }); };
  for (const s of sentencias) {
    for (const r of PROHIBIDO) if (r.re.test(s)) marca(errores, r);
    if (/\bdelete\s+from\b/.test(s) && !/\bwhere\b/.test(s)) marca(errores, { id: 'delete_sin_where', detalle: 'DELETE sin WHERE prohibido.' });
    if (/^update\b/.test(s) && !/\bwhere\b/.test(s)) marca(avisos, { id: 'update_sin_where', detalle: 'UPDATE sin WHERE: confirmar que es un backfill acotado.' });
    for (const r of ZONA_ROJA) if (r.re.test(s)) marca(zonaRoja, r);
  }
  return { errores, zonaRoja, avisos };
}

// cambios: [{ ruta, lineasAgregadas }] solo .sql nuevos/modificados (fuera de sql/_reversa).
export function revisarSql(cambios) {
  const motivos = [];
  const zonaRoja = [];
  for (const c of cambios) {
    if (!/\.sql$/i.test(c.ruta)) continue;
    if (/^sql\/_reversa\//.test(c.ruta.replace(/\\/g, '/'))) continue; // ya cae en zona protegida
    const r = analizarSql((c.lineasAgregadas ?? []).join('\n'));
    for (const e of r.errores) motivos.push({ codigo: 'sql_no_aditivo', ruta: c.ruta, detalle: `${c.ruta}: ${e.detalle}` });
    for (const z of r.zonaRoja) zonaRoja.push({ categoria: 'rls_permisos_roles', ruta: c.ruta, detalle: `${c.ruta}: ${z.detalle}` });
    if (r.errores.length) zonaRoja.push({ categoria: 'migracion_destructiva', ruta: c.ruta, detalle: `${c.ruta}: migración destructiva` });
  }
  return { motivos, zonaRoja };
}
