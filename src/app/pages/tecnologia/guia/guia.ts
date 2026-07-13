import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { UserService } from '../../../core/services/user.service';
import { TecHerramienta, TEC_CATEGORIAS } from '../../../../shared/models/tecnologia.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

interface CategoriaGroup {
  value: string;
  label: string;
  herramientas: TecHerramienta[];
}

@Component({
  selector: 'app-tec-guia',
  imports: [RouterLink, Skeleton],
  templateUrl: './guia.html',
  styleUrl: './guia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecGuia implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private userService = inject(UserService);

  herramientas = signal<TecHerramienta[]>([]);
  loading = signal(true);
  error = signal('');

  puedeGestionar = computed(() => this.userService.hasModulo('tecnologia'));

  // Agrupa por categoría respetando el orden de TEC_CATEGORIAS; oculta categorías vacías.
  grupos = computed<CategoriaGroup[]>(() => {
    const items = this.herramientas();
    return TEC_CATEGORIAS.map((cat) => ({
      value: cat.value,
      label: cat.label,
      herramientas: items.filter((h) => h.categoria === cat.value),
    })).filter((g) => g.herramientas.length > 0);
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const herramientas = await this.tecnologia.getHerramientas(true);
      this.herramientas.set(herramientas);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las herramientas.');
    } finally {
      this.loading.set(false);
    }
  }
}
