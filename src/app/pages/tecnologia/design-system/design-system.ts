import { Component, ChangeDetectionStrategy, signal } from '@angular/core';

// BD3 — Component gallery (galería de componentes del design system).
// Internal, es_tecnologia-gated. Renders the base tokens + shared components live
// so a token change can be verified in BOTH themes before any module migrates.
// The theme toggle scopes `data-theme` to this page's own wrapper (not the shell),
// so previewing dark here doesn't flip the whole app.
@Component({
  selector: 'app-tec-design-system',
  imports: [],
  templateUrl: './design-system.html',
  styleUrl: './design-system.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecDesignSystem {
  private _theme = signal<'light' | 'dark'>('light');
  theme = this._theme.asReadonly();

  // Semantic color tokens grouped for the swatch grid.
  readonly colorGroups: { title: string; tokens: string[] }[] = [
    { title: 'Superficies', tokens: ['--bg', '--surface', '--surface-2', '--surface-3', '--border', '--border-strong'] },
    { title: 'Texto', tokens: ['--text', '--text-2', '--text-3'] },
    { title: 'Marca / acento', tokens: ['--brand', '--brand-hover', '--brand-soft', '--accent', '--accent-soft'] },
    { title: 'Estados', tokens: ['--success', '--success-bg', '--danger', '--danger-bg', '--warning', '--warning-bg', '--info', '--info-bg'] },
    { title: 'Navegación', tokens: ['--nav-bg', '--nav-hover', '--nav-active', '--nav-text', '--nav-text-muted'] },
  ];

  readonly typeScale: { token: string; px: string }[] = [
    { token: '--fs-2xl', px: '28px' },
    { token: '--fs-xl', px: '22px' },
    { token: '--fs-lg', px: '18px' },
    { token: '--fs-md', px: '16px' },
    { token: '--fs-base', px: '14px' },
    { token: '--fs-sm', px: '13px' },
    { token: '--fs-xs', px: '12px' },
  ];

  readonly spaceScale: { token: string; px: string }[] = [
    { token: '--space-1', px: '4px' },
    { token: '--space-2', px: '8px' },
    { token: '--space-3', px: '12px' },
    { token: '--space-4', px: '16px' },
    { token: '--space-6', px: '24px' },
    { token: '--space-8', px: '32px' },
  ];

  readonly radiusScale: string[] = ['--radius-sm', '--radius', '--radius-lg', '--radius-pill'];
  readonly shadowScale: string[] = ['--shadow-sm', '--shadow', '--shadow-md', '--shadow-lg'];

  toggleTheme(): void {
    this._theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}
