import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-coming-soon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="coming-soon">
      <div class="coming-soon__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <h2 class="coming-soon__title">{{ section() }} — En construcción</h2>
      <p class="coming-soon__desc">Esta sección estará disponible en la próxima fase de desarrollo.</p>
    </div>
  `,
  styles: [`
    .coming-soon {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px 24px;
      text-align: center;
      gap: 14px;
    }
    .coming-soon__icon { color: var(--sgc-text-muted); opacity: 0.4; }
    .coming-soon__title { font-size: 18px; font-weight: 600; color: var(--sgc-text); }
    .coming-soon__desc { font-size: 14px; color: var(--sgc-text-muted); }
  `],
})
export class ComingSoon {
  section = input<string>('Sección');
}
