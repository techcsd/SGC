// ensure-environment.mjs — CY21 punto 4. `src/environments/environment.ts`
// está gitignored (BU1 F6): en un checkout/worktree limpio no existe, y
// `npm run build` fallaba duro (esbuild "Could not resolve
// '.../environment'") antes de que corriera ningún guard. Si falta, cae a
// environment.dev.ts (su anon key es público, seguro de usar aquí) — nunca a
// prod por defecto. `npm run env:dev`/`env:prod` lo sobreescriben a gusto.
import { existsSync, copyFileSync } from 'node:fs';

const DEST = 'src/environments/environment.ts';
if (!existsSync(DEST)) {
  copyFileSync('src/environments/environment.dev.ts', DEST);
  console.log(`[ensure-environment] ${DEST} no existía (checkout/worktree limpio) — generado desde environment.dev.ts. Usa "npm run env:dev"/"npm run env:prod" si necesitas otro entorno.`);
}
