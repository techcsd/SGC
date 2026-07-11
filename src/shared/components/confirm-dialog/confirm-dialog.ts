import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Small centered yes/no confirmation for actions worth a second thought
 * (sign out, delete, etc.). Self-contained: parent controls `open` and reacts
 * to `confirmed`/`cancelled`.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  open = input(false);
  title = input('¿Confirmar?');
  message = input('');
  confirmLabel = input('Confirmar');
  cancelLabel = input('Cancelar');
  /** 'danger' tints the confirm button red (destructive / sign-out). */
  tone = input<'default' | 'danger'>('default');

  confirmed = output<void>();
  cancelled = output<void>();
}
