import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { PracticaService } from '../../core/practica/practica.service';
import { UserService } from '../../core/services/user.service';
import { MISIONES_PILOTO } from '../../core/practica/practica.data';
import {
  MisionPractica, ResultadoPractica, ResultadoEquipoFila, ResultadoPersonaFila,
  CampoPractica, OpcionCampo, FilaMaterial, FilaConteo,
} from '../../core/practica/practica.model';

/**
 * CM7 — Modo práctica (web): simulador local con nota tipo examen. Datos de mentira,
 * nada sale a la red salvo la nota (practica_guardar_intento). El formulario de cada
 * misión se dibuja a partir de su esquema de campos (7b). Banda naranja + cronómetro +
 * objetivos en vivo; al terminar, resultado con anillo, estrellas y consejos.
 */
@Component({
  selector: 'app-practica',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './practica.html',
  styleUrl: './practica.scss',
})
export class Practica implements OnInit {
  practica = inject(PracticaService);
  private user = inject(UserService);

  fase = signal<'lista' | 'corre' | 'resultado' | 'equipo'>('lista');
  resultado = signal<ResultadoPractica | null>(null);
  cronometro = signal('0:00');
  private cronoTimer: ReturnType<typeof setInterval> | null = null;

  // CM7 7c — panel de equipo (jefe/RRHH/admin).
  puedeVerEquipo = signal(false);
  equipo = signal<ResultadoEquipoFila[]>([]);
  equipoCargando = signal(false);
  personaSel = signal<ResultadoEquipoFila | null>(null);
  personaDetalle = signal<ResultadoPersonaFila[]>([]);

  // 7b — valores del formulario (clave = id del campo). Única fuente de verdad del intento.
  valores = signal<Record<string, unknown>>({});
  // Selección del picker "agregar material" por cada campo de tipo 'materiales'.
  private nuevoArt = signal<Record<string, string>>({});

  misiones = computed(() => {
    const roles = this.user.roles();
    const esAdmin = roles.includes('admin');
    return MISIONES_PILOTO.filter((m) => esAdmin || m.roles.length === 0 || m.roles.some((r) => roles.includes(r)));
  });

  campos = computed<CampoPractica[]>(() => this.practica.mision()?.campos ?? []);

  // Objetivos en vivo (se marcan mientras practica) — computed PURO sobre `valores`.
  objetivosVivo = computed(() => {
    const m = this.practica.mision();
    const r = this.valores();
    return (m?.objetivos ?? []).map((o) => ({ id: o.id, texto: o.texto, puntos: o.puntos, ok: o.cumple(r), consejo: o.consejo }));
  });

  // ── Lectura/escritura genérica de campos ──
  valor(id: string): unknown { return this.valores()[id]; }
  valorStr(id: string): string { const v = this.valores()[id]; return typeof v === 'string' ? v : ''; }
  materialesDe(id: string): FilaMaterial[] { const v = this.valores()[id]; return Array.isArray(v) ? (v as FilaMaterial[]) : []; }
  conteoDe(id: string): FilaConteo[] { const v = this.valores()[id]; return Array.isArray(v) ? (v as FilaConteo[]) : []; }
  nuevoArtDe(id: string): string { return this.nuevoArt()[id] ?? ''; }
  setNuevoArt(id: string, v: string) { this.nuevoArt.update((x) => ({ ...x, [id]: v })); }

  private push(id: string, v: unknown) {
    this.valores.update((x) => ({ ...x, [id]: v }));
    this.practica.set(id, v);
  }
  setValor(id: string, v: unknown) { this.push(id, v); }

  // Materiales (agregar / cantidad / quitar).
  agregarMaterial(campo: CampoPractica) {
    const sel = this.nuevoArtDe(campo.id);
    const a = (campo.opciones ?? []).find((x) => x.id === sel);
    const actuales = this.materialesDe(campo.id);
    if (!a || actuales.some((i) => i.id === a.id)) return;
    this.push(campo.id, [...actuales, { id: a.id, nombre: a.nombre, stock: a.stock ?? 0, cantidad: 1 }]);
    this.setNuevoArt(campo.id, '');
  }
  setCantidadMat(campoId: string, itemId: string, v: string) {
    const n = Number(v) || 0;
    this.push(campoId, this.materialesDe(campoId).map((i) => (i.id === itemId ? { ...i, cantidad: n } : i)));
  }
  quitarMaterial(campoId: string, itemId: string) {
    this.push(campoId, this.materialesDe(campoId).filter((i) => i.id !== itemId));
  }

  // Conteo (editar lo contado por renglón).
  setContado(campoId: string, itemId: string, v: string) {
    const n = v.trim() === '' ? null : Math.max(0, Number(v) || 0);
    this.push(campoId, this.conteoDe(campoId).map((i) => (i.id === itemId ? { ...i, contado: n } : i)));
  }

  /** Valor inicial de un campo según su tipo. */
  private valorInicial(c: CampoPractica): unknown {
    if (c.tipo === 'materiales') return [];
    if (c.tipo === 'conteo') return (c.opciones ?? []).map((o) => ({ id: o.id, nombre: o.nombre, esperado: o.stock ?? 0, contado: null } as FilaConteo));
    if (c.tipo === 'numero') return null;
    return ''; // select, fecha, texto
  }

  entrar(m: MisionPractica) {
    this.practica.entrar(m);
    const init: Record<string, unknown> = {};
    for (const c of m.campos ?? []) init[c.id] = this.valorInicial(c);
    this.valores.set(init);
    this.nuevoArt.set({});
    for (const [k, v] of Object.entries(init)) this.practica.set(k, v);
    this.resultado.set(null);
    this.fase.set('corre');
    this.cronoTimer = setInterval(() => {
      const r = this.practica.evaluar();
      const s = r.duracionS;
      this.cronometro.set(`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`);
    }, 1000);
  }

  async terminar() {
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

  // ── CM7 7c — panel de equipo ──
  async ngOnInit() {
    try { this.puedeVerEquipo.set(await this.practica.puedeVerEquipo()); } catch { /* sin panel */ }
  }

  async verEquipo() {
    this.fase.set('equipo');
    this.personaSel.set(null);
    this.equipoCargando.set(true);
    try {
      this.equipo.set(await this.practica.resultadosEquipo());
    } catch {
      this.equipo.set([]);
    } finally {
      this.equipoCargando.set(false);
    }
  }

  async verPersona(f: ResultadoEquipoFila) {
    this.personaSel.set(f);
    this.personaDetalle.set([]);
    try {
      this.personaDetalle.set(await this.practica.resultadosPersona(f.usuario_id));
    } catch {
      this.personaDetalle.set([]);
    }
  }

  cerrarPersona() { this.personaSel.set(null); }
  volverLista() { this.fase.set('lista'); this.personaSel.set(null); }

  // trackBy helpers
  trackOpcion(_i: number, o: OpcionCampo) { return o.id; }
}
