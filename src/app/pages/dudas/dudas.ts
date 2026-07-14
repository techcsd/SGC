import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { DUDAS_CATEGORIAS, DudaCategoria, GUIAS_VISUALES, GuiaVisual } from './dudas-content';

@Component({
  selector: 'app-dudas',
  imports: [RouterLink],
  templateUrl: './dudas.html',
  styleUrl: './dudas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dudas {
  private userService = inject(UserService);

  searchQuery = signal('');
  expandedKey = signal<string | null>(null);

  private visibleCategorias = computed(() => DUDAS_CATEGORIAS.filter((c) => this.canSee(c)));

  guias = computed(() => GUIAS_VISUALES.filter((g) => this.canSeeGuia(g)));

  filteredCategorias = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const base = this.visibleCategorias();
    if (!q) return base;

    return base
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) => i.pregunta.toLowerCase().includes(q) || i.respuesta.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length > 0);
  });

  hasResults = computed(() => this.filteredCategorias().some((c) => c.items.length > 0));

  private canSee(c: DudaCategoria): boolean {
    if (this.userService.hasRole('admin')) return true;
    if (c.soloAdmin) return false;
    if (c.modulo) return this.userService.hasModulo(c.modulo);
    return true;
  }

  private canSeeGuia(g: GuiaVisual): boolean {
    if (this.userService.hasRole('admin')) return true;
    if (g.modulo) return this.userService.hasModulo(g.modulo);
    return true;
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  toggle(key: string) {
    this.expandedKey.update((cur) => (cur === key ? null : key));
  }

  isExpanded(key: string): boolean {
    return this.expandedKey() === key;
  }
}
