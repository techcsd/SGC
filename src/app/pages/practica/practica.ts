import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { PracticaService } from '../../core/practica/practica.service';
import { UserService } from '../../core/services/user.service';
import { MISIONES_PILOTO, OBRAS_DEMO, ARTICULOS_DEMO } from '../../core/practica/practica.data';
import { MisionPractica, ResultadoPractica } from '../../core/practica/practica.model';

interface ItemReq { id: string; nombre: string; stock: number; cantidad: number; }

/**
 * CM7 — Modo práctica (web, piloto): simulador local con nota tipo examen. Datos de mentira,
 * nada sale a la red salvo la nota (practica_guardar_intento). Banda naranja + cronómetro +
 * objetivos en vivo; al terminar, pantalla de resultado con anillo, estrellas y consejos.
 */
@Component({
  selector: 'app-practica',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './practica.html',
  styleUrl: './practica.scss',
})
export class Practica {
  practica = inject(PracticaService);
  private user = inject(UserService);

  readonly obras = OBRAS_DEMO;
  readonly articulos = ARTICULOS_DEMO;

  fase = signal<'lista' | 'corre' | 'resultado'>('lista');
  resultado = signal<ResultadoPractica | null>(null);
  cronometro = signal('0:00');
  private cronoTimer: ReturnType<typeof setInterval> | null = null;

  // Formulario de la misión "crear requisición" (en memoria).
  obraId = signal<string>('');
  items = signal<ItemReq[]>([]);
  fechaNecesidad = signal<string>('');
  motivo = signal<string>('');
  nuevoArt = signal<string>('');

  misiones = computed(() => {
    const roles = this.user.roles();
    const esAdmin = roles.includes('admin');
    return MISIONES_PILOTO.filter((m) => esAdmin || m.roles.length === 0 || m.roles.some((r) => roles.includes(r)));
  });

  /** Respuesta actual (pura, derivada de los signals del formulario). */
  private respuestaActual = computed(() => ({
    obraId: this.obraId(),
    items: this.items(),
    fechaNecesidad: this.fechaNecesidad(),
    motivo: this.motivo(),
  }));

  // Objetivos en vivo (se marcan mientras practica) — computed PURO.
  objetivosVivo = computed(() => {
    const m = this.practica.mision();
    const r = this.respuestaActual();
    return (m?.objetivos ?? []).map((o) => ({ id: o.id, texto: o.texto, puntos: o.puntos, ok: o.cumple(r), consejo: o.consejo }));
  });

  private sync() {
    const r = this.respuestaActual();
    for (const k of Object.keys(r)) this.practica.set(k, (r as Record<string, unknown>)[k]);
  }

  entrar(m: MisionPractica) {
    this.practica.entrar(m);
    this.obraId.set(''); this.items.set([]); this.fechaNecesidad.set(''); this.motivo.set(''); this.nuevoArt.set('');
    this.resultado.set(null);
    this.fase.set('corre');
    this.cronoTimer = setInterval(() => {
      const r = this.practica.evaluar();
      const s = r.duracionS;
      this.cronometro.set(`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`);
    }, 1000);
  }

  agregarItem() {
    const id = this.nuevoArt();
    const a = this.articulos.find((x) => x.id === id);
    if (!a || this.items().some((i) => i.id === id)) return;
    this.items.update((xs) => [...xs, { id: a.id, nombre: a.nombre, stock: a.stock, cantidad: 1 }]);
    this.nuevoArt.set('');
  }
  setCantidad(id: string, v: string) {
    const n = Number(v) || 0;
    this.items.update((xs) => xs.map((i) => (i.id === id ? { ...i, cantidad: n } : i)));
  }
  quitarItem(id: string) { this.items.update((xs) => xs.filter((i) => i.id !== id)); }

  async terminar() {
    this.sync();
    const res = this.practica.evaluar();
    this.resultado.set(res);
    this.fase.set('resultado');
    if (this.cronoTimer) { clearInterval(this.cronoTimer); this.cronoTimer = null; }
    await this.practica.guardar(res);
  }

  repetir() {
    const m = this.practica.mision();
    if (m) this.entrar(m);
  }
  salir() {
    if (this.cronoTimer) { clearInterval(this.cronoTimer); this.cronoTimer = null; }
    this.practica.salir();
    this.fase.set('lista');
  }

  estrellasArr(n: number): boolean[] { return [0, 1, 2].map((i) => i < n); }
}
