import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastService, Toast } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  imports: [],
  templateUrl: './toast.html',
  styleUrl: './toast.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastComponent {
  private toastService = inject(ToastService);
  private router = inject(Router);

  toasts = this.toastService.toasts;

  dismiss(id: number, event?: Event) {
    event?.stopPropagation();
    this.toastService.dismiss(id);
  }

  onClick(t: Toast) {
    if (t.route) {
      this.router.navigateByUrl(t.route);
    }
    this.dismiss(t.id);
  }

  iconFor(tipo: string): string {
    switch (tipo) {
      case 'success': return '✓';
      case 'warning': return '!';
      case 'error': return '✕';
      default: return 'i';
    }
  }
}
