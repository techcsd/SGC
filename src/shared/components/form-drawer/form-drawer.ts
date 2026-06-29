import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  effect,
} from '@angular/core';

@Component({
  selector: 'app-form-drawer',
  templateUrl: './form-drawer.html',
  styleUrl: './form-drawer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormDrawer {
  title = input<string>('');
  open = input<boolean>(false);
  closed = output<void>();

  constructor() {
    effect(() => {
      document.body.style.overflow = this.open() ? 'hidden' : '';
    });
  }

  close() {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('drawer-backdrop')) {
      this.close();
    }
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.close();
    }
  }
}
