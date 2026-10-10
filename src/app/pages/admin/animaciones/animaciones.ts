import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { MotionService, MomentoTipo, CelebracionTipo } from '../../../../shared/services/motion.service';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';
import { CountUpDirective } from '../../../../shared/motion/count-up.directive';
import { EstadoPulseDirective } from '../../../../shared/motion/estado-pulse.directive';
import { Icon } from '../../../../shared/ui/icon/icon';

interface CatRow {
  sistema: 'web' | 'app';
  id: string;
  nombre: string;
  nivel: 'grande' | 'mediano' | 'base';
  donde: string;
  pantallas: string[];
  duracion_ms: number;
  curva: string;
  reducido: string;
  desde_version: string;
  preview_key: string;
  estado: 'en_uso' | 'pendiente';
}

/**
 * CL5 — Administración › Animaciones: catálogo (solo consulta) de todo el movimiento
 * del sistema (web y app), desde `sgc.movimiento_catalogo`. Contadores, buscador,
 * filtros (nivel/sistema), tabla y vista previa EN VIVO con los componentes reales
 * (web) o una nota "vista de la app" (app). Conmutador local "ver reducida".
 */
@Component({
  selector: 'app-admin-animaciones',
  imports: [StaggerDirective, CountUpDirective, EstadoPulseDirective, Icon],
  templateUrl: './animaciones.html',
  styleUrl: './animaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAnimaciones implements OnInit, OnDestroy {
  private supabase = inject(SupabaseService);
  motion = inject(MotionService);
  /** Estado real de reduce-motion del usuario (para restaurarlo al salir). */
  private origReducida = false;

  rows = signal<CatRow[]>([]);
  loading = signal(true);
  error = signal('');

  busqueda = signal('');
  filtroNivel = signal<'todos' | 'grande' | 'mediano' | 'base'>('todos');
  filtroSistema = signal<'todos' | 'web' | 'app'>('todos');
  seleccion = signal<CatRow | null>(null);
  verReducida = signal(false);
  // demo del chip de estado (alterna al reproducir)
  estadoDemo = signal<'Pendiente' | 'Aprobada'>('Pendiente');
  // "nonce" para re-montar las demos base al reproducir
  demoNonce = signal(0);

  enUso = computed(() => this.rows().filter((r) => r.estado === 'en_uso').length);
  pantallasTotal = computed(() => {
    const set = new Set<string>();
    for (const r of this.rows()) for (const p of r.pantallas) set.add(p);
    return set.size;
  });

  filtradas = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const n = this.filtroNivel();
    const s = this.filtroSistema();
    return this.rows().filter(
      (r) =>
        (n === 'todos' || r.nivel === n) &&
        (s === 'todos' || r.sistema === s) &&
        (!q || r.nombre.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.donde.toLowerCase().includes(q)),
    );
  });

  // Filas de demo para appStagger (se re-montan con demoNonce).
  demoFilas = [1, 2, 3, 4, 5];

  async ngOnInit() {
    this.origReducida = document.documentElement.classList.contains('motion-reduced');
    try {
      const { data, error } = await this.supabase.client
        .from('movimiento_catalogo')
        .select('*')
        .order('sistema', { ascending: true })
        .order('nivel', { ascending: true });
      if (error) throw new Error(error.message);
      this.rows.set((data ?? []) as CatRow[]);
      if (this.rows().length) this.seleccion.set(this.rows()[0]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.');
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy() {
    // Restaura el ajuste REAL del usuario (el toggle es solo de la vista previa).
    this.aplicarClase(this.origReducida);
  }

  elegir(r: CatRow) {
    this.seleccion.set(r);
  }

  /** Conmutador LOCAL "ver reducida": aplica el modo en runtime para que la vista
   *  previa se vea reducida, SIN tocar el ajuste guardado del usuario (se restaura al
   *  salir de la pantalla, ngOnDestroy). */
  toggleReducida(v: boolean) {
    this.verReducida.set(v);
    this.aplicarClase(v);
  }

  private aplicarClase(reducida: boolean) {
    document.documentElement.classList.toggle('motion-reduced', reducida);
  }

  /** Reproduce la animación seleccionada con los componentes reales (solo web). */
  reproducir() {
    const r = this.seleccion();
    if (!r || r.sistema !== 'web') return;
    if (r.nivel === 'grande') {
      const tipo: CelebracionTipo = r.id === 'celebracion-ruta' ? 'ruta' : 'conduce';
      this.motion.celebrar(tipo, { numero: 'DEMO-0001', destino: 'Vista previa', verUrl: null });
    } else if (r.nivel === 'mediano') {
      const tipo = r.id.replace('momento-', '') as MomentoTipo;
      this.motion.momento(tipo, {});
    } else {
      // base: re-monta la demo y alterna el chip de estado.
      this.estadoDemo.update((e) => (e === 'Pendiente' ? 'Aprobada' : 'Pendiente'));
      this.demoNonce.update((n) => n + 1);
    }
  }
}
