import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormDrawer } from '../../../../../../shared/components/form-drawer/form-drawer';
import { Icon } from '../../../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../../../shared/i18n/translate.pipe';
import { Vehiculo } from '../../../../../../shared/models/vehiculo.model';
import { PaginaEmparejada } from '../../../../../../shared/services/flota-documentos-lector.service';
import { displayVehiculoCompleto, filtrarVehiculos } from '../../../../../../shared/utils/vehiculo-display.util';

/** DE1 (Ronda DE) — fila que el panel necesita para mostrarse (campos leídos + miniatura). */
export interface FilaParaAsignar extends PaginaEmparejada {
  thumb: string | null;
  /** DE2/DE-05 — miniatura del reverso emparejado por posición (null si no tiene). */
  reversoThumb?: string | null;
  reversoPagina?: number | null;
}

const CAMPOS_LABEL: Record<string, string> = {
  poliza: 'Póliza', aseguradora: 'Aseguradora', vigencia_desde: 'Vigencia desde', vigencia_hasta: 'Vigencia hasta',
  placa: 'Placa', chasis: 'Chasis (VIN)', marca: 'Marca', modelo: 'Modelo', anio: 'Año', color: 'Color',
  tipo_vehiculo: 'Tipo', numero_matricula: 'Matrícula', marbete_numero: 'Marbete',
};

/**
 * DE1 (Ronda DE, PROMPT-126 F2) — panel «Asignar…»: reemplaza el `<select>` de
 * solo-placa. Muestra la foto grande (zoom/girar), lo que la IA leyó con su
 * confianza, sugerencias con puntaje/razones (DE-02) y un buscador por
 * placa/alias/marca/modelo/chasis/responsable (DE-01) — nunca asigna sola.
 */
@Component({
  selector: 'app-asignar-documento-panel',
  templateUrl: './asignar-documento-panel.html',
  styleUrl: './asignar-documento-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormDrawer, Icon, TranslatePipe, DecimalPipe],
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class AsignarDocumentoPanel {
  abierto = input(false);
  fila = input<FilaParaAsignar | null>(null);
  /** F3 — miniatura/imagen grande del reverso emparejado (null hasta que F3 la provea). */
  reversoThumb = input<string | null>(null);
  vehiculos = input<Vehiculo[]>([]);
  /** F2 §4 — ids de vehículo que ya tienen otro documento del mismo tipo en este lote. */
  vehiculosConDocEnLote = input<Set<string>>(new Set());
  /** DE-03 — render a demanda (2×) de la página del PDF en memoria, o el original si es foto. */
  renderGrande = input<((pagina: number) => Promise<string>) | null>(null);

  cerrado = output<void>();
  asignado = output<string>();
  omitido = output<void>();

  busqueda = signal('');
  zoom = signal(1);
  rotacion = signal(0);
  lado = signal<'anverso' | 'reverso'>('anverso');
  imagenGrande = signal<string | null>(null);
  cargandoGrande = signal(false);

  campos = computed(() => {
    const f = this.fila();
    if (!f) return [];
    return Object.entries(f.campos)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => ({
        etiqueta: CAMPOS_LABEL[k] ?? k,
        valor: String(v),
        confianza: f.confianza?.[k] ?? null,
      }));
  });

  candidatosMuyProbables = computed(() => (this.fila()?.candidatos ?? []).filter((c) => c.nivel === 'muy_probable'));
  candidatosPosibles = computed(() => (this.fila()?.candidatos ?? []).filter((c) => c.nivel === 'posible'));

  vehiculosFiltrados = computed(() => {
    const idsEnCandidatos = new Set((this.fila()?.candidatos ?? []).map((c) => c.vehiculo_id));
    const resto = this.vehiculos().filter((v) => !idsEnCandidatos.has(v.id));
    return filtrarVehiculos(resto, this.busqueda());
  });

  constructor() {
    // Al abrir (o cambiar de fila mientras está abierto) reinicia la vista al anverso.
    effect(() => {
      if (this.abierto() && this.fila()) {
        this.busqueda.set('');
        this.abrirLado('anverso');
      }
    });
  }

  abrirLado(lado: 'anverso' | 'reverso') {
    this.lado.set(lado);
    this.zoom.set(1);
    this.rotacion.set(0);
    const f = this.fila();
    if (!f) return;
    if (lado === 'reverso') {
      this.imagenGrande.set(this.reversoThumb());
      return;
    }
    this.imagenGrande.set(f.thumb);
    const render = this.renderGrande();
    if (!render) return;
    this.cargandoGrande.set(true);
    render(f.pagina)
      .then((url) => { if (this.lado() === 'anverso') this.imagenGrande.set(url); })
      .catch(() => { /* se queda con el thumb chico */ })
      .finally(() => this.cargandoGrande.set(false));
  }

  display(v: Vehiculo): string {
    return displayVehiculoCompleto(v);
  }

  yaTieneDocEnLote(vehiculoId: string): boolean {
    return this.vehiculosConDocEnLote().has(vehiculoId);
  }

  elegir(vehiculoId: string) {
    this.asignado.emit(vehiculoId);
  }

  marcarNoEsDeLaFlota() {
    this.omitido.emit();
  }

  zoomIn() { this.zoom.update((z) => Math.min(z + 0.25, 3)); }
  zoomOut() { this.zoom.update((z) => Math.max(z - 0.25, 0.5)); }
  girar() { this.rotacion.update((r) => (r + 90) % 360); }

  onKeydown(ev: KeyboardEvent) {
    if (!this.abierto()) return;
    if (ev.key === '+' || ev.key === '=') { this.zoomIn(); ev.preventDefault(); }
    else if (ev.key === '-') { this.zoomOut(); ev.preventDefault(); }
    else if (ev.key.toLowerCase() === 'r') { this.girar(); ev.preventDefault(); }
    // Escape ya lo maneja app-form-drawer (cierra el panel completo).
  }

  cerrar() {
    this.cerrado.emit();
  }
}
