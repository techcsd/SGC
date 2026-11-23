import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConduceQrService } from '../../../shared/services/conduce-qr.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/** DS-34/#74 + DX7 — destino del QR (`/conduce-qr/:token` legado y `/d/:token`). Valida el token (firma + vencimiento) y abre la pantalla del
 *  conduce, donde el receptor confirma cantidades, firma y cierra la entrega. Requiere sesión (ruta del Shell). */
@Component({
  selector: 'app-conduce-qr',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './conduce-qr.html',
  styleUrl: './conduce-qr.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConduceQr implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private qr = inject(ConduceQrService);

  error = signal('');

  async ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      const r = await this.qr.resolver(token);
      // DX7 — la edge devuelve la ruta según el tipo (conduce → recibir; requisición → su detalle). Sin permiso, la pantalla destino lo dice.
      await this.router.navigateByUrl(r.ruta ?? `/conduce-recibir/${r.salidaId}`, { replaceUrl: true });
    } catch {
      this.error.set('Este QR no es válido o ya venció. Pide a quien te lo compartió que lo genere de nuevo.');
    }
  }
}
