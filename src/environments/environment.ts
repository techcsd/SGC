export const environment = {
  production: false,
  // Canonical public URL used to build auth-email links (invite / password
  // reset) so they always point at the live site — even when an admin creates
  // a user from a local dev session. Change to your localhost origin only if
  // you specifically want to test the email-link landing page locally.
  appUrl: 'https://sgcconstructorasd.com',
  supabaseUrl: 'https://jeeqhgccqefbqilntcpu.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplZXFoZ2NjcWVmYnFpbG50Y3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDI4OTEsImV4cCI6MjA5ODExODg5MX0.YMJQXxZUVZUBMh2TnIAz_0XGgpWEid-JQHbIAyoFqDs',
};
