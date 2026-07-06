import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  effect,
  viewChild,
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

  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const isOpen = this.open();
      document.body.style.overflow = isOpen ? 'hidden' : '';

      if (isOpen) {
        // Remember what had focus so we can restore it on close, then move
        // focus into the dialog (WCAG 2.4.3 / dialog pattern).
        this.previouslyFocused = document.activeElement as HTMLElement | null;
        setTimeout(() => this.focusFirst(), 0);
      } else if (this.previouslyFocused) {
        this.previouslyFocused.focus?.();
        this.previouslyFocused = null;
      }
    });

    inject(DestroyRef).onDestroy(() => {
      document.body.style.overflow = '';
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
      return;
    }
    // Focus trap: keep Tab cycling within the dialog.
    if (event.key === 'Tab') {
      const els = this.focusableElements();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  private focusableElements(): HTMLElement[] {
    const panel = this.panel()?.nativeElement;
    if (!panel) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
    );
  }

  private focusFirst() {
    const els = this.focusableElements();
    (els[0] ?? this.panel()?.nativeElement)?.focus();
  }
}
