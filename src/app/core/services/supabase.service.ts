import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  // Let TypeScript infer the full generic type from createClient
  readonly client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    db: { schema: 'sgc' },
  });
}
