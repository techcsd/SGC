import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { DudaCategoria, GuiaVisual } from './dudas-content';

// Z30 — el contenido ahora vive en sgc.ayuda_contenido (misma fuente que el app,
// sin duplicar). dudas-content.ts queda como semilla (scripts/seed-ayuda.mjs) y
// origen de los tipos.
@Component({
  selector: 'app-dudas',
  imports: [RouterLink],
  templateUrl: './dudas.html',
  styleUrl: './dudas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dudas {
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);

  searchQuery = signal('');
  expandedKey = signal<string | null>(null);

  private _guias = signal<GuiaVisual[]>([]);
  private _categorias = signal<DudaCategoria[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const { data } = await this.supabase.client
      .from('ayuda_contenido')
      .select('tipo, contenido, orden')
      .eq('activo', true)
      .order('orden', { ascending: true });
    const rows = (data ?? []) as { tipo: string; contenido: GuiaVisual | DudaCategoria }[];
    this._guias.set(rows.filter((r) => r.tipo === 'guia').map((r) => r.contenido as GuiaVisual));
    this._categorias.set(
      rows.filter((r) => r.tipo === 'duda_categoria').map((r) => r.contenido as DudaCategoria),
    );
  }

  private visibleCategorias = computed(() => this._categorias().filter((c) => this.canSee(c)));

  guias = computed(() => this._guias().filter((g) => this.canSeeGuia(g)));

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
