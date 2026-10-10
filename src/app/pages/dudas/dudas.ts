import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { SignedUrlCache } from '../../../shared/services/signed-url-cache.service';
import { BienvenidaService } from '../../../shared/services/bienvenida.service';
import { DudaCategoria, GuiaVisual } from './dudas-content';

/** CK5 — URLs firmadas del video de una guía (bucket privado `tutoriales`). */
export interface GuiaVideoUrls { video: string; poster: string | null; vtt: string | null; duracion: number | null; }

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
  private signedUrls = inject(SignedUrlCache);
  private bienvenida = inject(BienvenidaService);
  private readonly BUCKET_TUTORIALES = 'tutoriales';

  /** CL3 — "Ver la bienvenida otra vez". */
  verBienvenida() { this.bienvenida.verOtraVez(); }

  searchQuery = signal('');
  expandedKey = signal<string | null>(null);
  // CK5 — filtro "Con video".
  soloConVideo = signal(false);
  // CK5 — URLs firmadas del video por guía (id → urls).
  videoUrls = signal<Record<string, GuiaVideoUrls>>({});

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
    const guias = rows.filter((r) => r.tipo === 'guia').map((r) => r.contenido as GuiaVisual);
    this._guias.set(guias);
    this._categorias.set(
      rows.filter((r) => r.tipo === 'duda_categoria').map((r) => r.contenido as DudaCategoria),
    );
    await this.cargarVideos(guias);
  }

  /** CK5 — resuelve las URLs firmadas de los videos (bucket privado). */
  private async cargarVideos(guias: GuiaVisual[]): Promise<void> {
    const conVideo = guias.filter((g) => g.video_path);
    if (!conVideo.length) return;
    const map: Record<string, GuiaVideoUrls> = {};
    await Promise.all(conVideo.map(async (g) => {
      const video = await this.signedUrls.signed(this.BUCKET_TUTORIALES, g.video_path);
      if (!video) return;
      map[g.id] = {
        video,
        poster: g.poster_path ? await this.signedUrls.signed(this.BUCKET_TUTORIALES, g.poster_path) : null,
        vtt: g.vtt_path ? await this.signedUrls.signed(this.BUCKET_TUTORIALES, g.vtt_path) : null,
        duracion: g.duracion_s ?? null,
      };
    }));
    this.videoUrls.set(map);
  }

  /** CK5 — ¿esta guía tiene video listo? */
  tieneVideo(g: GuiaVisual): boolean {
    return !!this.videoUrls()[g.id];
  }

  private visibleCategorias = computed(() => this._categorias().filter((c) => this.canSee(c)));

  guias = computed(() => this._guias()
    .filter((g) => this.canSeeGuia(g))
    .filter((g) => !this.soloConVideo() || !!this.videoUrls()[g.id]));

  /** CK5 — hay al menos una guía con video (para mostrar el filtro). */
  hayVideos = computed(() => Object.keys(this.videoUrls()).length > 0);

  toggleSoloConVideo() { this.soloConVideo.update((v) => !v); }

  formatDuracion(s: number | null | undefined): string {
    if (!s) return '';
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

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
