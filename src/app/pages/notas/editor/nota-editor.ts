import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  ElementRef,
  viewChild,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { NotasService, DirectorioUsuario } from '../../../../shared/services/notas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import {
  Nota,
  NotaCompartido,
  NotaChecklistItem,
  NotaPermiso,
  TareaVinculable,
  NOTA_COLORES,
} from '../../../../shared/models/nota.model';

/**
 * AD9 — Editor de nota en PÁGINA COMPLETA con barra de herramientas tipo Word,
 * checklist "de verdad" (ítems clicables, reordenables, vinculables a una Tarea)
 * y "Compartir con…" desde la creación. Autosave (patrón U9). Reemplaza al drawer.
 *
 * El cuerpo se guarda como HTML en `notas.contenido` (contenteditable + execCommand,
 * sin sintaxis manual). El checklist vive en `sgc.nota_checklist_items`.
 */
@Component({
  selector: 'app-nota-editor',
  imports: [RouterLink],
  templateUrl: './nota-editor.html',
  styleUrl: './nota-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotaEditor implements OnInit, OnDestroy {
  private notasSvc = inject(NotasService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly COLORES = NOTA_COLORES;
  private bodyRef = viewChild<ElementRef<HTMLDivElement>>('body');

  // Estado de la nota.
  notaId = signal<string | null>(null);
  titulo = signal('');
  contenido = signal('');
  color = signal<string | null>(null);
  pinned = signal(false);
  archivada = signal(false);
  soloLectura = signal(false); // compartida-ver

  checklist = signal<NotaChecklistItem[]>([]);
  compartidos = signal<NotaCompartido[]>([]);
  directorio = signal<DirectorioUsuario[]>([]);
  tareas = signal<TareaVinculable[]>([]);

  nuevoItemTexto = signal('');
  compartirUsuario = signal<string | null>(null);
  compartirPermiso = signal<NotaPermiso>('ver');
  linkingItemId = signal<string | null>(null); // ítem cuyo selector de tarea está abierto

  loading = signal(true);
  guardando = signal(false);
  guardadoOk = signal(false);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdatedAt: string | null = null;
  private destroyed = false;

  esNueva = computed(() => this.notaId() === null);
  checklistProgreso = computed(() => {
    const items = this.checklist();
    const done = items.filter((i) => i.done).length;
    return { done, total: items.length };
  });

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    // Directorio + tareas para los selectores (no bloquean el render).
    void this.cargarSelectores();
    if (id && id !== 'nueva') {
      await this.cargar(id);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // Descarta una nota totalmente vacía creada al vuelo (sin título/cuerpo/checklist/compartidos).
    void this.descartarSiVacia();
  }

  private async cargarSelectores() {
    try {
      const [dir, tar] = await Promise.all([
        this.notasSvc.getDirectorio(),
        this.notasSvc.getTareasVinculables(),
      ]);
      this.directorio.set(dir.filter((u) => u.id !== this.userService.profile()?.id));
      this.tareas.set(tar);
    } catch {
      /* selectores opcionales */
    }
  }

  private async cargar(id: string) {
    this.loading.set(true);
    try {
      // AH18 — traer la nota DIRECTO por id (RLS decide acceso). Evita el bug de
      // "no muestra nada / da error" que causaba traer todas-mis-notas y filtrar
      // cuando el perfil aún no estaba cargado (carrera) o en casos borde.
      const miId = this.userService.profile()?.id ?? null;
      const nota = await this.notasSvc.getNota(id, miId);
      const permiso: NotaPermiso =
        !nota || (miId && nota.owner_id === miId) ? 'editar' : nota.mi_permiso ?? 'ver';
      if (!nota) {
        this.toast.error('Nota no encontrada', 'Puede que ya no exista o no tengas acceso.');
        this.router.navigate(['/notas']);
        return;
      }
      this.notaId.set(nota.id);
      this.titulo.set(nota.titulo ?? '');
      this.contenido.set(nota.contenido ?? '');
      this.color.set(nota.color);
      this.pinned.set(nota.pinned);
      this.archivada.set(nota.archivada);
      this.lastUpdatedAt = nota.updated_at;
      this.soloLectura.set(permiso === 'ver');
      // Refleja el cuerpo en el contenteditable.
      queueMicrotask(() => {
        const el = this.bodyRef()?.nativeElement;
        if (el) el.innerHTML = nota!.contenido ?? '';
      });
      await Promise.all([this.recargarChecklist(), this.recargarCompartidos()]);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo abrir la nota');
    } finally {
      this.loading.set(false);
    }
  }

  private async recargarChecklist() {
    const id = this.notaId();
    if (!id) return;
    try {
      this.checklist.set(await this.notasSvc.getChecklist(id));
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo cargar el checklist');
    }
  }

  private async recargarCompartidos() {
    const id = this.notaId();
    if (!id || this.soloLectura()) return;
    try {
      this.compartidos.set(await this.notasSvc.getCompartidos(id));
    } catch {
      /* solo el dueño puede leerlos */
    }
  }

  // ── Asegura que exista la nota (para checklist/compartir/autosave) ─────────
  private async ensureNota(): Promise<string | null> {
    if (this.notaId()) return this.notaId();
    const id = crypto.randomUUID();
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id,
          titulo: this.titulo().trim(),
          contenido: this.contenido(),
          color: this.color(),
          pinned: this.pinned(),
          archivada: this.archivada(),
        },
        null,
      );
      this.notaId.set(res.nota.id);
      this.lastUpdatedAt = res.nota.updated_at;
      // Reement URL sin recargar para que el detalle tenga id estable.
      this.router.navigate(['/notas', res.nota.id], { replaceUrl: true });
      return res.nota.id;
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo crear la nota');
      return null;
    }
  }

  // ── Barra de herramientas (contenteditable) ────────────────────────────────
  exec(cmd: string, value?: string) {
    if (this.soloLectura()) return;
    this.bodyRef()?.nativeElement.focus();
    document.execCommand(cmd, false, value);
    this.onBodyInput();
  }

  onBodyInput() {
    const html = this.bodyRef()?.nativeElement.innerHTML ?? '';
    this.contenido.set(html);
    this.programarGuardado();
  }

  onTitulo(value: string) {
    this.titulo.set(value);
    this.programarGuardado();
  }

  setColor(c: string | null) {
    if (this.soloLectura()) return;
    this.color.set(this.color() === c ? null : c);
    this.programarGuardado();
  }

  togglePin() {
    if (this.soloLectura()) return;
    this.pinned.update((v) => !v);
    this.programarGuardado();
  }

  toggleArchivar() {
    if (this.soloLectura()) return;
    this.archivada.update((v) => !v);
    this.programarGuardado();
  }

  // ── Autosave (debounce, patrón U9) ─────────────────────────────────────────
  private programarGuardado() {
    if (this.soloLectura()) return;
    this.guardadoOk.set(false);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.guardar(), 800);
  }

  async guardar() {
    if (this.soloLectura() || this.guardando()) return;
    const id = await this.ensureNota();
    if (!id) return;
    this.guardando.set(true);
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id,
          titulo: this.titulo().trim(),
          contenido: this.contenido(),
          color: this.color(),
          pinned: this.pinned(),
          archivada: this.archivada(),
        },
        this.lastUpdatedAt,
      );
      this.lastUpdatedAt = res.nota.updated_at;
      this.guardadoOk.set(true);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar la nota');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Checklist ───────────────────────────────────────────────────────────────
  async agregarItem() {
    const texto = this.nuevoItemTexto().trim();
    if (!texto || this.soloLectura()) return;
    const id = await this.ensureNota();
    if (!id) return;
    try {
      const orden = (this.checklist().at(-1)?.orden ?? 0) + 1;
      const item = await this.notasSvc.addChecklistItem(id, texto, orden);
      this.checklist.update((l) => [...l, item]);
      this.nuevoItemTexto.set('');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo agregar el ítem');
    }
  }

  async toggleItem(item: NotaChecklistItem) {
    if (this.soloLectura()) return;
    const next = !item.done;
    this.checklist.update((l) => l.map((i) => (i.id === item.id ? { ...i, done: next } : i)));
    try {
      await this.notasSvc.updateChecklistItem(item.id, { done: next });
    } catch (e: unknown) {
      this.checklist.update((l) => l.map((i) => (i.id === item.id ? { ...i, done: !next } : i)));
      this.toast.errorFrom(e, 'No se pudo actualizar el ítem');
    }
  }

  async editarTextoItem(item: NotaChecklistItem, texto: string) {
    if (this.soloLectura() || texto === item.texto) return;
    this.checklist.update((l) => l.map((i) => (i.id === item.id ? { ...i, texto } : i)));
    try {
      await this.notasSvc.updateChecklistItem(item.id, { texto });
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar el texto');
    }
  }

  async quitarItem(item: NotaChecklistItem) {
    if (this.soloLectura()) return;
    this.checklist.update((l) => l.filter((i) => i.id !== item.id));
    try {
      await this.notasSvc.removeChecklistItem(item.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo quitar el ítem');
      await this.recargarChecklist();
    }
  }

  async moverItem(item: NotaChecklistItem, dir: -1 | 1) {
    if (this.soloLectura()) return;
    const list = [...this.checklist()];
    const idx = list.findIndex((i) => i.id === item.id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= list.length) return;
    [list[idx], list[swap]] = [list[swap], list[idx]];
    const reordered = list.map((i, n) => ({ ...i, orden: n + 1 }));
    this.checklist.set(reordered);
    try {
      await this.notasSvc.reordenarChecklist(reordered.map((i) => ({ id: i.id, orden: i.orden })));
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo reordenar');
      await this.recargarChecklist();
    }
  }

  abrirVincular(item: NotaChecklistItem) {
    this.linkingItemId.set(this.linkingItemId() === item.id ? null : item.id);
  }

  async vincularTarea(item: NotaChecklistItem, tareaId: string) {
    this.linkingItemId.set(null);
    try {
      await this.notasSvc.linkChecklistItem(item.id, tareaId ? 'tarea' : null, tareaId || null);
      await this.recargarChecklist();
      if (tareaId) this.toast.success('Vinculado a la tarea', 'El ítem se marcará solo cuando la tarea se complete.');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo vincular');
    }
  }

  async desvincularTarea(item: NotaChecklistItem) {
    try {
      await this.notasSvc.linkChecklistItem(item.id, null, null);
      await this.recargarChecklist();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo desvincular');
    }
  }

  // ── Compartir ────────────────────────────────────────────────────────────────
  async agregarCompartido() {
    const usuarioId = this.compartirUsuario();
    if (!usuarioId || this.soloLectura()) return;
    const id = await this.ensureNota();
    if (!id) return;
    try {
      await this.notasSvc.compartir(id, usuarioId, this.compartirPermiso());
      this.compartirUsuario.set(null);
      await this.recargarCompartidos();
      this.toast.success('Nota compartida');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo compartir');
    }
  }

  async cambiarPermiso(c: NotaCompartido, permiso: NotaPermiso) {
    const id = this.notaId();
    if (!id) return;
    try {
      await this.notasSvc.cambiarPermiso(id, c.usuario_id, permiso);
      await this.recargarCompartidos();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo cambiar el permiso');
    }
  }

  async quitarCompartido(c: NotaCompartido) {
    const id = this.notaId();
    if (!id) return;
    try {
      await this.notasSvc.quitarCompartido(id, c.usuario_id);
      await this.recargarCompartidos();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo quitar');
    }
  }

  private async descartarSiVacia() {
    const id = this.notaId();
    if (!id) return;
    const vacia =
      !this.titulo().trim() &&
      !this.textoPlano(this.contenido()).trim() &&
      this.checklist().length === 0 &&
      this.compartidos().length === 0;
    if (vacia) {
      try {
        await this.notasSvc.eliminarNota(id);
      } catch {
        /* best-effort */
      }
    }
  }

  private textoPlano(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }

  volver() {
    this.router.navigate(['/notas']);
  }
}
