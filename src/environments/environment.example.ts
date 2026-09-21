// PLANTILLA de environment.ts (BU1 F6). El environment.ts real es LOCAL y está
// gitignored: genéralo con `npm run env:dev` (apunta a sgc-dev) o `npm run env:prod`.
// Los builds de Vercel/CI usan environment.dev.ts / environment.prod.ts vía build-env.mjs.
export const environment = {
  production: false,
  entorno: 'dev',
  appUrl: 'https://dev.sgcconstructorasd.com',
  supabaseUrl: '',
  supabaseAnonKey: '',
};
