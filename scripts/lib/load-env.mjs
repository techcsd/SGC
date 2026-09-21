// scripts/lib/load-env.mjs — carga .env.local en process.env (sin dependencias).
// Las variables ya presentes en el entorno real (p. ej. SUPABASE_ACCESS_TOKEN)
// tienen prioridad y NO se sobrescriben. Importar con efecto: `import './lib/load-env.mjs'`.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = join(ROOT, '.env.local');
if (existsSync(file)) {
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
