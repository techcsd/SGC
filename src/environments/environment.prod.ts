export const environment = {
  production: true,
  // Canonical public URL used to build auth-email links (invite / password
  // reset) so they always point at the live site — never at whatever origin
  // the admin's browser happens to be on when creating a user.
  appUrl: 'https://sgcconstructorasd.com',
  supabaseUrl: 'https://jeeqhgccqefbqilntcpu.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplZXFoZ2NjcWVmYnFpbG50Y3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDI4OTEsImV4cCI6MjA5ODExODg5MX0.YMJQXxZUVZUBMh2TnIAz_0XGgpWEid-JQHbIAyoFqDs',
};
