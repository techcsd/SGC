import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * P3 — subnav de pestañas que unifica las vistas hermanas de Flota que antes eran
 * ítems de menú sueltos y redundantes (auditoría AU1):
 *   · monitoreo   → Seguimiento (mapa) / Rutas activas (lista) / Recorrido diario
 *   · combustible → Registro / Echadas (log) / Dashboards / Conciliación
 *   · conductores → Conductores / Estado
 * No fusiona componentes ni cambia rutas: solo navega entre ellas como pestañas.
 */
type Grupo = 'monitoreo' | 'combustible' | 'conductores';
interface Tab { label: string; route: string; }

const GRUPOS: Record<Grupo, Tab[]> = {
  monitoreo: [
    { label: 'Mapa en vivo', route: '/flota/seguimiento' },
    { label: 'Rutas activas', route: '/flota/rutas-activas' },
    { label: 'Recorrido diario', route: '/flota/recorrido-diario' },
  ],
  combustible: [
    { label: 'Registro', route: '/flota/combustible' },
    { label: 'Echadas (log)', route: '/flota/combustible-log' },
    { label: 'Dashboards', route: '/flota/combustible-dashboard' },
    { label: 'Conciliación', route: '/flota/conciliacion-combustible' },
  ],
  conductores: [
    { label: 'Conductores', route: '/flota/conductores' },
    { label: 'Estado', route: '/flota/conductores-estado' },
  ],
};

@Component({
  selector: 'app-flota-subnav',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flota-subnav" aria-label="Vistas relacionadas">
      @for (t of tabs; track t.route) {
        <a class="flota-subnav__tab" [routerLink]="t.route"
           routerLinkActive="flota-subnav__tab--active" [routerLinkActiveOptions]="{ exact: true }">
          {{ t.label }}
        </a>
      }
    </nav>
  `,
  styles: [`
    .flota-subnav {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--sgc-border, #2d2d2d);
      padding-bottom: 8px;
    }
    .flota-subnav__tab {
      padding: 6px 14px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      color: var(--sgc-text-muted, #929090);
      transition: all 0.15s ease;
    }
    .flota-subnav__tab:hover { background: var(--sgc-surface-hover, rgba(255,179,0,0.06)); color: var(--sgc-text, inherit); }
    .flota-subnav__tab--active {
      color: var(--sgc-text, inherit);
      background: var(--sgc-surface-hover, rgba(255,179,0,0.08));
      box-shadow: inset 0 -2px 0 var(--Hub, #ffb300);
    }
  `],
})
export class FlotaSubnav {
  grupo = input.required<Grupo>();
  get tabs(): Tab[] { return GRUPOS[this.grupo()]; }
}
