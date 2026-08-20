import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  MODULOS_DISPONIBLES,
  SUBMODULOS,
  PermisosMap,
  SubmoduloInfo,
} from '../../../../shared/services/roles.service';

/** Nivel homologado que se muestra en el control de 3 posiciones. */
type NivelUI = '' | 'ver' | 'operar';
/** AS4 — estado del módulo completo en el encabezado tri-estado. */
type TriEstado = 'todo' | 'parcial' | 'nada';

interface GrupoModulo {
  key: string;
  label: string;
  desc: string;
  sensible: boolean;
  /** Submódulos visibles (filtrados por búsqueda). */
  subs: SubmoduloInfo[];
  /** El módulo tiene submódulos configurables (define si es expandible). */
  tieneSubs: boolean;
}

/**
 * AS4 — editor de permisos como matriz Rol × Módulo/Submódulo.
 * Componente CONTROLADO: recibe el estado (módulos completos + mapa de permisos)
 * y emite el estado COMPLETO nuevo en cada cambio; el padre solo lo persiste.
 *
 * - Un renglón por cada módulo del sistema (con y sin submódulos).
 * - Encabezado con tri-estado (Todo / Parcial / Nada) que cascadea a los submódulos
 *   y contador "X de Y submódulos".
 * - Cada submódulo: control Sin acceso / Ver / Operar + descripción en una línea.
 * - Búsqueda en vivo por módulo o permiso.
 * - Chip "Próximamente" donde el submódulo aún no se gatea end-to-end (`enforced` falso).
 */
@Component({
  selector: 'app-role-permisos-editor',
  templateUrl: './role-permisos-editor.html',
  styleUrl: './role-permisos-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolePermisosEditor {
  /** Módulos completos (cada uno = 'operar' heredado en todos sus submódulos). */
  selectedModulos = input<string[]>([]);
  /** Mapa "modulo.submodulo" → nivel (grants granulares explícitos). */
  permisos = input<PermisosMap>({});
  /** id único para prefijar ids (edición vs creación). */
  idPrefix = input<string>('perm');

  /** Estado COMPLETO nuevo de módulos completos. */
  modulosChange = output<string[]>();
  /** Estado COMPLETO nuevo del mapa de permisos granulares. */
  permisosChange = output<PermisosMap>();

  search = signal('');
  /** Módulos expandidos (por key). Por defecto plegados; la búsqueda los abre. */
  private expanded = signal<Set<string>>(new Set());

  /** Grupos visibles según el buscador. */
  grupos = computed<GrupoModulo[]>(() => {
    const q = this.search().trim().toLowerCase();
    return MODULOS_DISPONIBLES
      .map((m) => {
        const allSubs = SUBMODULOS[m.key] ?? [];
        const modMatch = !q || m.label.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q);
        const subs = !q || modMatch
          ? allSubs
          : allSubs.filter(
              (s) => s.label.toLowerCase().includes(q) || (s.descripcion ?? '').toLowerCase().includes(q),
            );
        return {
          key: m.key,
          label: m.label,
          desc: m.desc,
          sensible: !!m.sensible,
          subs,
          tieneSubs: allSubs.length > 0,
        };
      })
      .filter((g) => (!this.search().trim() ? true : g.subs.length > 0 || g.desc.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)));
  });

  // ── Estado por módulo ───────────────────────────────────────────────────

  private subsDe(modKey: string): SubmoduloInfo[] {
    return SUBMODULOS[modKey] ?? [];
  }

  moduloCompleto(modKey: string): boolean {
    return this.selectedModulos().includes(modKey);
  }

  /** Tri-estado del módulo: Todo (completo) / Parcial (algún grant) / Nada. */
  triEstado(modKey: string): TriEstado {
    if (this.moduloCompleto(modKey)) return 'todo';
    const p = this.permisos();
    const n = this.subsDe(modKey).filter((s) => !!p[s.key]).length;
    return n > 0 ? 'parcial' : 'nada';
  }

  /** Nº de submódulos con acceso / total (para el contador del encabezado). */
  activos(modKey: string): number {
    const subs = this.subsDe(modKey);
    if (this.moduloCompleto(modKey)) return subs.length;
    const p = this.permisos();
    return subs.filter((s) => !!p[s.key]).length;
  }
  total(modKey: string): number {
    return this.subsDe(modKey).length;
  }

  // ── Expansión ───────────────────────────────────────────────────────────

  isExpanded(modKey: string): boolean {
    return !!this.search().trim() || this.expanded().has(modKey);
  }

  toggleGrupo(modKey: string) {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(modKey)) next.delete(modKey);
      else next.add(modKey);
      return next;
    });
  }

  // ── Submódulo ───────────────────────────────────────────────────────────

  heredado(subKey: string): boolean {
    return this.moduloCompleto(subKey.split('.')[0]);
  }

  nivelDe(subKey: string): NivelUI {
    return this.permisos()[subKey] ?? '';
  }

  // ── Mutaciones (calculan y emiten el estado completo) ────────────────────

  private withoutModulo(modKey: string): string[] {
    return this.selectedModulos().filter((m) => m !== modKey);
  }
  private withModulo(modKey: string): string[] {
    const cur = this.selectedModulos();
    return cur.includes(modKey) ? cur : [...cur, modKey];
  }
  private clearGranular(modKey: string, from?: PermisosMap): PermisosMap {
    const next: PermisosMap = { ...(from ?? this.permisos()) };
    for (const s of this.subsDe(modKey)) delete next[s.key];
    return next;
  }

  /** Cascada del encabezado tri-estado. */
  setTri(modKey: string, tri: TriEstado) {
    if (tri === 'todo') {
      // Módulo completo: quita grants granulares redundantes.
      this.modulosChange.emit(this.withModulo(modKey));
      this.permisosChange.emit(this.clearGranular(modKey));
      return;
    }
    if (tri === 'nada') {
      this.modulosChange.emit(this.withoutModulo(modKey));
      this.permisosChange.emit(this.clearGranular(modKey));
      return;
    }
    // Parcial: explota a grants explícitos (todos en Operar) para poder ajustar por submódulo.
    const next = this.clearGranular(modKey);
    for (const s of this.subsDe(modKey)) next[s.key] = 'operar';
    this.modulosChange.emit(this.withoutModulo(modKey));
    this.permisosChange.emit(next);
  }

  /** Cambia el nivel de un submódulo. Si el módulo estaba completo, primero lo "explota". */
  setNivel(modKey: string, subKey: string, nivel: NivelUI) {
    if (this.moduloCompleto(modKey)) {
      // Explota el módulo completo en grants explícitos y aplica el override en subKey.
      const next: PermisosMap = { ...this.permisos() };
      for (const s of this.subsDe(modKey)) {
        if (s.key === subKey) {
          if (nivel) next[s.key] = nivel;
          else delete next[s.key];
        } else {
          next[s.key] = 'operar';
        }
      }
      this.modulosChange.emit(this.withoutModulo(modKey));
      this.permisosChange.emit(next);
      return;
    }
    const next: PermisosMap = { ...this.permisos() };
    if (nivel) next[subKey] = nivel;
    else delete next[subKey];
    this.permisosChange.emit(next);
  }
}
