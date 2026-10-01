import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

interface CarnetPublico {
  encontrado: boolean;
  nombre?: string;
  cargo?: string | null;
  obra?: string | null;
  carnet?: string | null;
  estado?: 'activo' | 'inactivo';
}

/** CE5 — Página PÚBLICA de verificación de carnet (QR). Sin login; solo datos mínimos. */
@Component({
  selector: 'app-verificar',
  imports: [],
  templateUrl: './verificar.html',
  styleUrl: './verificar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Verificar implements OnInit {
  private route = inject(ActivatedRoute);
  private supabase = inject(SupabaseService);

  loading = signal(true);
  data = signal<CarnetPublico | null>(null);

  async ngOnInit() {
    const carnet = this.route.snapshot.paramMap.get('carnet') ?? '';
    try {
      const { data, error } = await this.supabase.client.rpc('verificar_carnet', { p_carnet: carnet });
      if (error) throw error;
      this.data.set(data as CarnetPublico);
    } catch {
      this.data.set({ encontrado: false });
    } finally {
      this.loading.set(false);
    }
  }
}
