import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MotionService, MomentoTipo } from '../../services/motion.service';

/**
 * CJ2/CJ3/CN5 — Celebración global a pantalla completa. `conduce` = escena CJ2 (hoja →
 * carpeta), `ruta` = escena CJ3 (camión + calle), y los **tipos de momento** salen como
 * **escenas a pantalla completa** (CN5, mock `Escena.dc.html`): velo navy, halo + onda,
 * la escena, check naranja con rebote (1,1s), título + dato y "Toca para continuar"; 1,8s.
 * No bloquea; tocar o Esc la salta. reduce-motion = velo + check + texto (sin la escena).
 * Montada una vez en el shell; la dispara `MotionService.celebrar(...)` / `.momento(...)`.
 */
@Component({
  selector: 'app-celebracion',
  imports: [],
  templateUrl: './celebracion.html',
  styleUrl: './celebracion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'motion.cerrar()' },
})
export class Celebracion {
  motion = inject(MotionService);
  private router = inject(Router);

  /** Título por defecto de cada escena de momento (CN5). */
  private labels: Record<MomentoTipo, string> = {
    entrada: 'Entrada registrada',
    salida: 'Salida despachada',
    aprobado: 'Aprobado',
    firma: 'Firmado',
    combustible: 'Combustible registrado',
    checklist: 'Inspección enviada',
    mantenimiento: 'Mantenimiento cerrado',
    mensaje: 'Enviado',
    documento: 'Documento listo',
    uso: 'Vehículo tomado',
  };

  /** ¿La celebración actual es una escena de momento (no conduce/ruta)? */
  esEscena = computed(() => this.motion.esEscena(this.motion.tipo()));

  /** ¿Animaciones reducidas? (ajuste del usuario o del SO). */
  reducido = computed(() => {
    try {
      return (
        document.documentElement.classList.contains('motion-reduced') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      );
    } catch { return false; }
  });

  /** Título de la tarjeta según el tipo. */
  tituloCel = computed(() => {
    const t = this.motion.tipo();
    if (t === 'conduce') return 'Conduce creado';
    if (t === 'ruta') return 'Ruta creada';
    return this.motion.datos().texto || this.labels[t] || '';
  });

  /** Subtítulo de una escena de momento (el que llama pasa el dato real). */
  subCel = computed(() => this.motion.datos().sub || '');

  /** Texto para lectores de pantalla (incluye número/destino/sub si hay). */
  tituloSr = computed(() => {
    const d = this.motion.datos();
    const base = this.tituloCel();
    if (this.esEscena()) return `${base}${d.sub ? '. ' + d.sub : ''}.`;
    const num = d.numero ? ' ' + d.numero : '';
    const dest = d.destino ? ', destino ' + d.destino : '';
    return `${base}${num}${dest}.`;
  });

  ver() {
    const url = this.motion.datos().verUrl;
    this.motion.cerrar();
    if (url) void this.router.navigateByUrl(url);
  }
}
