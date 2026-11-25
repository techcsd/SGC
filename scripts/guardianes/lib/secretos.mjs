// G1 — escáner de secretos sobre líneas AGREGADAS. NUNCA devuelve el valor, solo regla + ruta + línea.
const REGLAS = [
  { id: 'anthropic_key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: 'openai_like_key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { id: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{40,}/ },
  { id: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'supabase_pat', re: /\bsbp_[a-f0-9]{30,}\b/ },
  { id: 'resend_key', re: /\bre_[A-Za-z0-9]{20,}\b/ },
  { id: 'vercel_token', re: /\bvercel_[A-Za-z0-9]{20,}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'clave_privada', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: 'asignacion_secreto', re: /\b(?:secret|token|api[_-]?key|password|passwd|private[_-]?key|service[_-]?role[_-]?key)\w*\s*[:=]\s*['"][^'"\s${}]{20,}['"]/i },
  { id: 'url_con_credenciales', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{6,}@[^\s]+/i },
];
const PLACEHOLDER = /(?:\b(?:your|tu)\b|example|ejemplo|changeme|placeholder|xxx+|<[^>]+>|\*{3,}|process\.env|secrets\.|\$\{\{)/i;

export function escanearTexto(texto) {
  const hallazgos = [];
  const lineas = String(texto).split('\n');
  lineas.forEach((l, i) => {
    for (const r of REGLAS) {
      if (r.re.test(l) && !PLACEHOLDER.test(l)) hallazgos.push({ regla: r.id, linea: i + 1 });
    }
  });
  return hallazgos;
}

// cambios: [{ ruta, lineasAgregadas: string[] }] -> motivos[]
export function escanearSecretos(cambios) {
  const motivos = [];
  for (const c of cambios) {
    const h = escanearTexto((c.lineasAgregadas ?? []).join('\n'));
    for (const x of h) {
      motivos.push({ codigo: 'secreto', ruta: c.ruta, detalle: `Posible secreto (${x.regla}) en ${c.ruta} (línea agregada #${x.linea}). Valor omitido a propósito.` });
    }
  }
  return motivos;
}
