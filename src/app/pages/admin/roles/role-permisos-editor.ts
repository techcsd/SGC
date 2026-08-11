import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  MODULOS_DISPONIBLES,
  SUBMODULOS,
  PermisosMap,
  SubmoduloInfo,
} from '../../../../shared/services/roles.service';

/** Nivel homologado que se muestra en el control de 3 posiciones. */
type NivelUI = '' | 'ver' | 'operar';

interface GrupoSubmodulos {
  key: string;
  label: string;
  subs: SubmoduloInfo[];
}

/**
 * AN2 — editor reutilizable de "Permisos por submódulo".
 * Presentacional: recibe el estado (módulos marcados + mapa de permisos) y emite
 * el cambio de nivel de un submódulo. Lo usan los drawers de crear y editar rol.
 *
 * - Grupos plegables por módulo (label sin cortar feo).
 * - Buscador de submódulos por etiqueta.
 * - Control homologado Sin acceso / Ver / Operar por submódulo.
 * - Estado heredado (read-only "Operar (heredado)") cuando el módulo padre está marcado.
 * - Chip "PRÓXIMAMENTE" en submódulos aún no gateados.
 */
@Component({
  selector: 'app-role-permisos-editor',
  templateUrl: './role-permisos-editor.html',
  styleUrl: './role-permisos-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolePermisosEditor {
  /** Módulos marcados en el drawer (módulo completo = 'operar' heredado en sus submódulos). */
  selectedModulos = input<string[]>([]);
  /** Mapa "modulo.submodulo" → nivel (grants granulares explícitos). */
  permisos = input<PermisosMap>({});
  /** id único para prefijar los ids de los radios (edición vs creación). */
  idPrefix = input<string>('perm');

  /** Emite el cambio de nivel de un submódulo. `nivel` '' = quitar el grant. */
  permisoChange = output<{ key: string; nivel: NivelUI }>();

  private readonly modulosConSubmodulos = MODULOS_DISPONIBLES.filter((m) => !!SUBMODULOS[m.key]);

  search = signal('');
  /** Módulos plegados (por key). Por defecto todos expandidos. */
  private collapsed = signal<Set<string>>(new Set());

  /** Grupos visibles según el buscador (oculta grupos sin coincidencias). */
  grupos = computed<GrupoSubmodulos[]>(() => {
    const q = this.search().trim().toLowerCase();
    return this.modulosConSubmodulos
      .map((m) => ({
        key: m.key,
        label: m.label,
        subs: (SUBMODULOS[m.key] ?? []).filter(
          (s) => !q || s.label.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.subs.length > 0);
  });

  /** Cuántos submódulos de un módulo tienen grant explícito (para el contador del encabezado). */
  grantsDe(moduloKey: string): number {
    const p = this.permisos();
    return (SUBMODULOS[moduloKey] ?? []).filter((s) => !!p[s.key]).length;
  }

  /** Un grupo se ve expandido si no está plegado o si hay una búsqueda activa. */
  isExpanded(moduloKey: string): boolean {
    return !!this.search().trim() || !this.collapsed().has(moduloKey);
  }

  toggleGrupo(moduloKey: string) {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(moduloKey)) next.delete(moduloKey);
      else next.add(moduloKey);
      return next;
    });
  }

  /** El módulo completo está marcado en el drawer. */
  moduloCompleto(moduloKey: string): boolean {
    return this.selectedModulos().includes(moduloKey);
  }

  /** El módulo padre está marcado → todos sus submódulos son 'operar' heredado. */
  heredado(subKey: string): boolean {
    return this.selectedModulos().includes(subKey.split('.')[0]);
  }

  nivelDe(subKey: string): NivelUI {
    return this.permisos()[subKey] ?? '';
  }

  setNivel(subKey: string, nivel: NivelUI) {
    this.permisoChange.emit({ key: subKey, nivel });
  }
}
