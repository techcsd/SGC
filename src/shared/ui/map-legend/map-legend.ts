import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * AW11 — Leyenda reutilizable del mapa de recorridos (Recorrido diario,
 * Seguimiento, replay de rutas). Colapsable. Iconos por SVG (regla AW12),
 * con los MISMOS colores que dibujan los mapas:
 *   verde = inicio · ámbar = parada (numerada) · rojo = último punto/fin ·
 *   línea azul = trayecto · badge "en vivo".
 */
@Component({
  selector: 'app-map-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mlg" [class.mlg--open]="abierto()">
      <button type="button" class="mlg__toggle" (click)="abierto.set(!abierto())" [attr.aria-expanded]="abierto()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        Leyenda
        <svg class="mlg__caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      @if (abierto()) {
        <ul class="mlg__list">
          @if (mostrarInicio()) {
            <li>
              <span class="mlg__pin" style="color:#16a34a">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="#fff"/></svg>
              </span> {{ inicioLabel() }}
            </li>
          }
          @if (mostrarParada()) {
            <li>
              <span class="mlg__pin" style="color:#f59e0b">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="#fff"/></svg>
              </span> Parada (numerada)
            </li>
          }
          @if (mostrarFin()) {
            <li>
              <span class="mlg__pin" style="color:#dc2626">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="#fff"/></svg>
              </span> {{ finLabel() }}
            </li>
          }
          @if (mostrarSinSenal()) {
            <li>
              <span class="mlg__pin" style="color:#9ca3af">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="#fff"/></svg>
              </span> Sin señal (posición vieja)
            </li>
          }
          @if (mostrarTrayecto()) {
            <li><span class="mlg__line"></span> Trayecto recorrido</li>
          }
          @if (mostrarVivo()) {
            <li><span class="mlg__vivo">en vivo</span> Posición actualizándose</li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
    .mlg {
      position: absolute;
      right: 10px;
      bottom: 10px;
      z-index: 5;
      background: rgba(20, 20, 20, 0.92);
      border: 1px solid #2d2d2d;
      border-radius: 10px;
      color: #f5f5f5;
      font-size: 12px;
      max-width: 200px;
    }
    .mlg__toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 7px 10px;
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font: inherit;
    }
    .mlg__caret { margin-left: auto; transition: transform 0.2s ease; }
    .mlg--open .mlg__caret { transform: rotate(180deg); }
    .mlg__list { list-style: none; margin: 0; padding: 4px 10px 10px; display: grid; gap: 6px; }
    .mlg__list li { display: flex; align-items: center; gap: 8px; line-height: 1.2; }
    .mlg__pin { display: inline-flex; flex: 0 0 auto; width: 14px; height: 14px; }
    .mlg__pin svg { width: 14px; height: 14px; }
    .mlg__line { flex: 0 0 auto; width: 18px; height: 3px; border-radius: 2px; background: #2563eb; }
    .mlg__vivo {
      flex: 0 0 auto;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      background: #16a34a;
      color: #fff;
    }
    `,
  ],
})
export class MapLegend {
  /** Filas configurables — el default reproduce Recorrido diario (retrocompat). */
  mostrarInicio = input<boolean>(true);
  /** Etiqueta del pin verde (Recorrido: "Inicio del día"; ruta: "Inicio de ruta"). */
  inicioLabel = input<string>('Inicio del día');
  /** Parada numerada (ámbar) — solo mapas que las dibujan (Recorrido diario). */
  mostrarParada = input<boolean>(true);
  mostrarFin = input<boolean>(true);
  /** Etiqueta del pin rojo (Recorrido: "Último punto / fin"; ruta: "Fin"). */
  finLabel = input<string>('Último punto / fin');
  /** Pin gris — marcador atenuado por señal vieja (Seguimiento, AV1). */
  mostrarSinSenal = input<boolean>(false);
  mostrarTrayecto = input<boolean>(true);
  /** Muestra la fila "en vivo" (Seguimiento / recorrido del día en curso). */
  mostrarVivo = input<boolean>(false);
  /** Empieza colapsada o abierta. */
  abiertaInicial = input<boolean>(true);

  abierto = signal(true);

  constructor() {
    queueMicrotask(() => this.abierto.set(this.abiertaInicial()));
  }
}
