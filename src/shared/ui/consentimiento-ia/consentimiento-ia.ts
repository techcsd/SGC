import { Component, ChangeDetectionStrategy, input, output, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { PrivacidadService } from '../../services/privacidad.service';
import { ToastService } from '../../services/toast.service';

/**
 * CI10 — Hoja "Asistente con inteligencia artificial". Se muestra antes del primer
 * uso de una función de IA (asistente, transcripción, lectura de recibos). Nombra a
 * Anthropic (Claude) y Groq/OpenAI. "Permitir" guarda el consentimiento; "Ahora no"
 * lo deja para después (el resto de la app funciona igual). Revocable en Perfil ›
 * Privacidad.
 */
@Component({
  selector: 'app-consentimiento-ia',
  imports: [TranslatePipe],
  templateUrl: './consentimiento-ia.html',
  styleUrl: './consentimiento-ia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsentimientoIA {
  private privacidad = inject(PrivacidadService);
  private toast = inject(ToastService);

  /** El padre controla la visibilidad. */
  visible = input<boolean>(false);
  /** Emite true si otorgó, false si eligió "Ahora no". */
  decidido = output<boolean>();

  guardando = signal(false);

  async permitir() {
    this.guardando.set(true);
    try {
      await this.privacidad.setConsentimiento('ia', true);
      this.decidido.emit(true);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo guardar el consentimiento');
    } finally {
      this.guardando.set(false);
    }
  }

  ahoraNo() {
    this.decidido.emit(false);
  }
}
