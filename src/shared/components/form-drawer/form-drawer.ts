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
  /**
   * U4 — evita perder datos: si el form tiene cambios sin guardar, cerrar por
   * click-afuera o Escape pide confirmación. Se auto-detecta cualquier
   * `<form class="ng-dirty">` proyectado (cubre todo el sistema sin tocar cada
   * página); las páginas con estado en signals pueden además pasar [dirty].
   */
  dirty = input<boolean>(false);
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

  /** Hay cambios sin guardar (input explícito o `<form>` proyectado en ng-dirty). */
  private hayCambios(): boolean {
    if (this.dirty()) return true;
    return !!this.panel()?.nativeElement?.querySelector('form.ng-dirty');
  }

  /** Cierre "suave" (backdrop/Escape): confirma si hay cambios sin guardar. */
  private intentarCerrar() {
    if (this.hayCambios() && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
    this.close();
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('drawer-backdrop')) {
      this.intentarCerrar();
    }
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.intentarCerrar();
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
