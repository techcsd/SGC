import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserService } from '../../../app/core/services/user.service';
import { BienvenidaService } from '../../services/bienvenida.service';
import { NovedadesService, VersionNovedad } from '../../services/novedades.service';
import { CAMBIO_META, semverCode } from '../../models/app-version.model';
import { Icon } from '../../ui/icon/icon';
import { formatFechaDisplay } from '../../utils/fecha.util';

/**
 * CO2 — "Novedades" a pantalla completa. Se muestra DESPUÉS del logo/login y de
 * la bienvenida CL3 (nunca encima), con "lo que reportaste ya está arreglado"
 * arriba, luego versión por versión (máx. 5) con chips NUEVO/ARREGLO/MEJORA.
 * "Entendido"/Esc marca vista (servidor) — no vuelve a salir hasta la próxima
 * versión publicada.
 */
@Component({
  selector: 'app-novedades',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  templateUrl: './novedades.html',
  styleUrl: './novedades.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class Novedades {
  private userService = inject(UserService);
  private bienvenida = inject(BienvenidaService);
  private service = inject(NovedadesService);

  readonly CAMBIO_META = CAMBIO_META;
  readonly fFecha = formatFechaDisplay;

  abierta = signal(false);
  cargando = signal(true);
  versiones = signal<VersionNovedad[]>([]);
  arregladoParaTi = signal<string[]>([]);
  hayMas = signal(false);
  versionVista = signal<string | null>(null);

  nombre = computed(() => (this.userService.profile()?.nombre ?? '').split(' ')[0] || '');
  rango = computed(() => {
    const vs = this.versiones();
    if (!vs.length) return '';
    const vista = this.versionVista();
    const ultima = vs[0].version; // vienen desc
    return vista ? `${vista} → ${ultima} · ${vs.length} versión${vs.length === 1 ? '' : 'es'}` : `${vs.length} versión${vs.length === 1 ? '' : 'es'} nueva${vs.length === 1 ? '' : 's'}`;
  });
  tituloVersionMasReciente = computed(() => this.versiones()[0]?.titulo ?? null);

  private arrancada = false;

  constructor() {
    // Espera a que la bienvenida CL3 termine (visita nueva o ya vista) antes de
    // decidir si hay novedades que mostrar — nunca pisa el primer-ingreso.
    effect(() => {
      const profile = this.userService.profile();
      if (!profile || this.arrancada) return;
      if (!this.bienvenida.cerradaEnSesion()) return; // aún no sabemos si la bienvenida va a salir
      this.arrancada = true;
      void this.cargar();
    });
  }

  private async cargar() {
    this.cargando.set(true);
    try {
      const r = await this.service.pendientes('web');
      // Orden estable: la API ya trae desc por versión (más reciente primero).
      const vs = [...r.versiones].sort((a, b) => semverCode(b.version) - semverCode(a.version));
      this.versiones.set(vs);
      this.arregladoParaTi.set(r.arreglado_para_ti);
      this.hayMas.set(r.hay_mas);
      this.versionVista.set(r.version_vista);
      if (r.tiene_pendientes) this.abierta.set(true);
    } catch (e) {
      console.error('Novedades.cargar error:', e);
    } finally {
      this.cargando.set(false);
    }
  }

  async cerrar() {
    if (!this.abierta()) return;
    this.abierta.set(false);
    const ultima = this.versiones()[0]?.version;
    if (ultima) {
      try {
        await this.service.marcarVistas('web', ultima);
      } catch (e) {
        console.error('Novedades.marcarVistas error:', e);
      }
    }
  }

  tagLabel(t: string): string {
    return this.CAMBIO_META[t]?.label ?? t;
  }
  tagBadgeClass(t: string): string {
    const badge = this.CAMBIO_META[t]?.badge ?? 'neutral';
    return 'sgc-badge sgc-badge--' + badge;
  }
}
