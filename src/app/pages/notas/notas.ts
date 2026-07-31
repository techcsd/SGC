import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { NotasService, DirectorioUsuario } from '../../../shared/services/notas.service';
import { Nota, NotaCompartido, NotaPermiso, NOTA_COLORES } from '../../../shared/models/nota.model';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';

type NotasTab = 'mias' | 'compartidas';

/** Línea del cuerpo interpretada para el preview: texto plano o ítem de checklist. */
interface LineaPreview {
  idx: number;
  tipo: 'check' | 'texto';
  checked: boolean;
  texto: string;
}

const CHECK_RE = /^(\s*-\s*\[)( |x|X)(\]\s?)(.*)$/;

@Component({
  selector: 'app-notas',
  imports: [DatePipe, FormDrawer, Skeleton, ConfirmDialog],
  templateUrl: './notas.html',
  styleUrl: './notas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Notas implements OnInit {
  private notasSvc = inject(NotasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private router = inject(Router);

  miId = this.userService.profile()?.id ?? '';

  readonly colores = NOTA_COLORES;

  // ── Estado de listas ──────────────────────────────────────
  misNotas = signal<Nota[]>([]);
  compartidasNotas = signal<Nota[]>([]);
  private nombrePorId = new Map<string, string>();
  private directorio = signal<DirectorioUsuario[]>([]);

  tab = signal<NotasTab>('mias');
  verArchivadas = signal(false);
  searchQuery = signal('');
  loading = signal(true);
  error = signal('');

  // ── Editor ────────────────────────────────────────────────
  editorOpen = signal(false);
  private currentId = signal<string>('');
  isNew = signal(false);
  openedNota = signal<Nota | null>(null);
  private editorUpdatedAt: string | null = null;

  tituloText = signal('');
  contenidoText = signal('');
  colorSel = signal<string | null>(null);
  pinnedSel = signal(false);
  archivadaSel = signal(false);
  saving = signal(false);

  // ── Compartir ─────────────────────────────────────────────
  compartidos = signal<NotaCompartido[]>([]);
  shareBuscar = signal('');
  sharing = signal(false);

  // ── Confirmar borrado ─────────────────────────────────────
  confirmDeleteOpen = signal(false);

  // ── Permisos del editor ───────────────────────────────────
  esOwner = computed(() => this.isNew() || this.openedNota()?.owner_id === this.miId);
  puedeEditar = computed(
    () => this.isNew() || this.esOwner() || this.openedNota()?.mi_permiso === 'editar',
  );
  soloVer = computed(() => !this.puedeEditar());
  /** Compartir requiere una nota ya persistida y ser dueño. */
  puedeCompartir = computed(() => this.esOwner() && !this.isNew());

  // ── Derivados de lista ────────────────────────────────────
  notasVisibles = computed<Nota[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    let list =
      this.tab() === 'mias'
        ? this.misNotas().filter((n) => (this.verArchivadas() ? n.archivada : !n.archivada))
        : this.compartidasNotas().filter((n) => !n.archivada);

    if (q) {
      list = list.filter(
        (n) =>
          (n.titulo ?? '').toLowerCase().includes(q) ||
          (n.contenido ?? '').toLowerCase().includes(q),
      );
    }

    return [...list].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at),
    );
  });

  countArchivadas = computed(() => this.misNotas().filter((n) => n.archivada).length);

  /** Preview del cuerpo del editor con checkboxes interactivos. */
  lineasPreview = computed<LineaPreview[]>(() => this.parseLineas(this.contenidoText()));

  /** Candidatos para compartir: directorio filtrado, sin mí ni los ya compartidos. */
  shareResultados = computed<DirectorioUsuario[]>(() => {
    const q = this.shareBuscar().toLowerCase().trim();
    const yaCompartidos = new Set(this.compartidos().map((c) => c.usuario_id));
    return this.directorio()
      .filter((u) => u.id !== this.miId && !yaCompartidos.has(u.id))
      .filter((u) => !q || u.nombre.toLowerCase().includes(q))
      .slice(0, 8);
  });

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const dir = await this.notasSvc.getDirectorio();
      this.directorio.set(dir);
      this.nombrePorId = new Map(dir.map((u) => [u.id, u.nombre]));
      await this.refrescar();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las notas.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refrescar() {
    const [mias, compartidas] = await Promise.all([
      this.notasSvc.getMisNotas(this.miId, true),
      this.notasSvc.getCompartidasConmigo(this.miId),
    ]);
    this.misNotas.set(mias);
    this.compartidasNotas.set(
      compartidas.map((n) => ({ ...n, owner_nombre: this.nombrePorId.get(n.owner_id) ?? 'Usuario' })),
    );
  }

  cambiarTab(tab: NotasTab) {
    this.tab.set(tab);
  }

  // ── Presentación de tarjetas ──────────────────────────────
  /** Extracto legible: primeras líneas sin los marcadores de checklist. */
  excerpt(n: Nota): string {
    const raw = (n.contenido ?? '').trim();
    if (!raw) return 'Sin contenido';
    const clean = raw
      .split('\n')
      .map((l) => l.replace(CHECK_RE, (_m, _p1, mark, _p3, txt) => `${mark.trim() ? '☑' : '☐'} ${txt}`))
      .join('  ');
    return clean.length > 140 ? clean.slice(0, 140) + '…' : clean;
  }

  ownerNombre(n: Nota): string {
    return n.owner_nombre ?? this.nombrePorId.get(n.owner_id) ?? 'Usuario';
  }

  // ── Editor ────────────────────────────────────────────────
  // AD9 — el alta y la apertura ahora van a la PÁGINA COMPLETA (editor v2),
  // no al drawer. Se conserva el drawer legacy solo como fallback.
  openNueva() {
    this.router.navigate(['/notas/nueva']);
  }

  openNota(n: Nota) {
    this.router.navigate(['/notas', n.id]);
  }

  closeEditor() {
    this.editorOpen.set(false);
  }

  onTituloInput(value: string) {
    this.tituloText.set(value);
  }

  onContenidoInput(value: string) {
    this.contenidoText.set(value);
  }

  seleccionarColor(color: string | null) {
    if (this.soloVer()) return;
    this.colorSel.set(color);
  }

  togglePinnedEditor() {
    if (this.soloVer()) return;
    this.pinnedSel.update((v) => !v);
  }

  toggleArchivadaEditor() {
    if (this.soloVer()) return;
    this.archivadaSel.update((v) => !v);
  }

  /** Alterna el estado de un ítem de checklist reescribiendo su línea. */
  toggleChecklistLine(idx: number) {
    if (this.soloVer()) return;
    const lines = this.contenidoText().split('\n');
    const line = lines[idx];
    if (line === undefined) return;
    lines[idx] = line.replace(CHECK_RE, (_m, p1, mark, p3, txt) => {
      const nuevo = mark.trim() ? ' ' : 'x';
      return `${p1}${nuevo}${p3}${txt}`;
    });
    this.contenidoText.set(lines.join('\n'));
  }

  /** Inserta una línea de checklist vacía al final del cuerpo. */
  agregarChecklist() {
    if (this.soloVer()) return;
    const actual = this.contenidoText();
    const sep = actual && !actual.endsWith('\n') ? '\n' : '';
    this.contenidoText.set(`${actual}${sep}- [ ] `);
  }

  private parseLineas(contenido: string): LineaPreview[] {
    return contenido.split('\n').map((line, idx) => {
      const m = line.match(CHECK_RE);
      if (m) {
        return { idx, tipo: 'check' as const, checked: m[2].trim().toLowerCase() === 'x', texto: m[4] };
      }
      return { idx, tipo: 'texto' as const, checked: false, texto: line };
    });
  }

  async guardar() {
    if (this.saving() || this.soloVer()) return;
    const titulo = this.tituloText().trim();
    const contenido = this.contenidoText();
    if (!titulo && !contenido.trim()) {
      this.toast.warning('Nota vacía', 'Escribe un título o algún contenido.');
      return;
    }

    this.saving.set(true);
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id: this.currentId(),
          titulo,
          contenido,
          color: this.colorSel(),
          pinned: this.pinnedSel(),
          archivada: this.archivadaSel(),
        },
        this.editorUpdatedAt,
      );

      if (res.conflict) {
        this.toast.warning(
          'Conflicto de edición',
          'Otra persona editó esta nota después; se guardó tu versión (gana la última edición).',
        );
      } else {
        this.toast.success('Nota guardada');
      }

      this.editorUpdatedAt = res.nota.updated_at;
      this.isNew.set(false);
      this.openedNota.set(res.nota);
      await this.refrescar();
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar la nota', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Eliminar ──────────────────────────────────────────────
  pedirEliminar() {
    if (!this.esOwner() || this.isNew()) return;
    this.confirmDeleteOpen.set(true);
  }

  cancelarEliminar() {
    this.confirmDeleteOpen.set(false);
  }

  async confirmarEliminar() {
    this.confirmDeleteOpen.set(false);
    const id = this.currentId();
    try {
      await this.notasSvc.eliminarNota(id);
      this.toast.success('Nota eliminada');
      this.editorOpen.set(false);
      await this.refrescar();
    } catch (e: unknown) {
      this.toast.error('No se pudo eliminar la nota', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Pin rápido desde la tarjeta (solo dueño) ──────────────
  async togglePinCard(n: Nota, event: Event) {
    event.stopPropagation();
    if (n.owner_id !== this.miId) return;
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id: n.id,
          titulo: n.titulo,
          contenido: n.contenido,
          color: n.color,
          pinned: !n.pinned,
          archivada: n.archivada,
        },
        n.updated_at,
      );
      // Reflejar en la lista sin recargar todo.
      this.misNotas.update((list) => list.map((x) => (x.id === n.id ? res.nota : x)));
    } catch (e: unknown) {
      this.toast.error('No se pudo fijar la nota', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Compartir ─────────────────────────────────────────────
  private async cargarCompartidos(notaId: string) {
    try {
      this.compartidos.set(await this.notasSvc.getCompartidos(notaId));
    } catch {
      this.compartidos.set([]);
    }
  }

  onShareBuscar(value: string) {
    this.shareBuscar.set(value);
  }

  async agregarCompartido(usuario: DirectorioUsuario, permiso: NotaPermiso) {
    if (!this.puedeCompartir() || this.sharing()) return;
    this.sharing.set(true);
    try {
      await this.notasSvc.compartir(this.currentId(), usuario.id, permiso);
      this.shareBuscar.set('');
      await this.cargarCompartidos(this.currentId());
      this.toast.success('Nota compartida', `Con ${usuario.nombre} (${permiso})`);
    } catch (e: unknown) {
      this.toast.error('No se pudo compartir', e instanceof Error ? e.message : undefined);
    } finally {
      this.sharing.set(false);
    }
  }

  async cambiarPermiso(c: NotaCompartido, permiso: NotaPermiso) {
    if (!this.puedeCompartir() || c.permiso === permiso) return;
    try {
      await this.notasSvc.cambiarPermiso(this.currentId(), c.usuario_id, permiso);
      await this.cargarCompartidos(this.currentId());
    } catch (e: unknown) {
      this.toast.error('No se pudo cambiar el permiso', e instanceof Error ? e.message : undefined);
    }
  }

  async quitarCompartido(c: NotaCompartido) {
    if (!this.puedeCompartir()) return;
    try {
      await this.notasSvc.quitarCompartido(this.currentId(), c.usuario_id);
      await this.cargarCompartidos(this.currentId());
    } catch (e: unknown) {
      this.toast.error('No se pudo quitar el acceso', e instanceof Error ? e.message : undefined);
    }
  }

  onSelectPermiso(c: NotaCompartido, value: string) {
    this.cambiarPermiso(c, value === 'editar' ? 'editar' : 'ver');
  }

  iniciales(nombre: string): string {
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase();
  }
}
