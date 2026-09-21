// DEV build environment (Vercel Preview / rama dev / npm run build:dev).
// BU1 F6 — apunta a sgc-dev. El anon key es público (seguro en repo), igual que prod.
export const environment = {
  production: true,
  entorno: 'dev',
  appUrl: 'https://app-dev.sgcconstructorasd.com',
  supabaseUrl: 'https://fzfrnrvndzrjwyvdpkgg.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6ZnJucnZuZHpyand5dmRwa2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDEyNDEsImV4cCI6MjEwNTU3NzI0MX0.uR7pGPwSfLo3R9T1P_XMhpxA4as58Wv-lxWCJNep0tU',
};
