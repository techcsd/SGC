import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { Icon } from '../../../../shared/ui/icon/icon';
import { MarkdownEditor } from '../../../../shared/ui/markdown-editor/markdown-editor';
import { Router } from '@angular/router';
import { NotasService, DirectorioUsuario } from '../../../../shared/services/notas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { Nota, NotaCompartido, NotaPermiso } from '../../../../shared/models/nota.model';

type Tab = 'mias' | 'compartidas';

const HANDOFF_TPL = `# HANDOFF — <sesión>

**Fecha:** \n**Repo / versión:** \n

## Hecho
-

## Verificado
-

## Pendiente
-

## Decisiones
-
`;

/**
 * BP5 — "Dev notes": notas técnicas en Markdown (con bloques de código), personales
 * y compartidas, reutilizando sgc.notas (ambito='dev'). Gate por rol es_tecnologia.
 */
@Component({
  selector: 'app-dev-notes',
  imports: [Icon, MarkdownEditor],
  templateUrl: './dev-notes.html',
  styleUrl: './dev-notes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevNotes implements OnInit {
  private notasSvc = inject(NotasService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private router = inject(Router);

  tab = signal<Tab>('mias');
  mias = signal<Nota[]>([]);
  compartidas = signal<Nota[]>([]);
  loading = signal(true);
  query = signal('');
  tagFiltro = signal<string | null>(null);

  // Nota abierta (copia de trabajo).
  activa = signal<Nota | null>(null);
  titulo = signal('');
  contenido = signal('');
  tags = signal<string[]>([]);
  nuevoTag = signal('');
  guardando = signal(false);
  private lastUpdatedAt: string | null = null;

  // ── Compartir (reutiliza el flujo de notas: mismo directorio + RPCs) ────────
  directorio = signal<DirectorioUsuario[]>([]);
  compartidos = signal<NotaCompartido[]>([]);
  compartirUsuario = signal<string | null>(null);
  compartirPermiso = signal<NotaPermiso>('ver');
  /** true cuando la nota abierta ya existe en BD (se puede compartir/mover). */
  persistida = signal(false);

  soloLectura = computed(() => {
    const n = this.activa();
    const miId = this.userService.profile()?.id;
    return !!n && n.owner_id !== miId && n.mi_permiso === 'ver';
  });

  esOwner = computed(() => {
    const n = this.activa();
    const miId = this.userService.profile()?.id;
    return !!n && n.owner_id === miId;
  });

  /** Solo el dueño de una nota ya persistida puede compartirla / moverla. */
  puedeCompartir = computed(() => this.esOwner() && this.persistida());

  lista = computed(() => {
    const base = this.tab() === 'mias' ? this.mias() : this.compartidas();
    const q = this.query().trim().toLowerCase();
    const tag = this.tagFiltro();
    return base
      .filter((n) => !tag || (n.tags ?? []).includes(tag))
      .filter((n) => !q || (n.titulo + ' ' + n.contenido).toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
  });

  tagsDisponibles = computed(() => {
    const set = new Set<string>();
    for (const n of [...this.mias(), ...this.compartidas()]) (n.tags ?? []).forEach((t) => set.add(t));
    return [...set].sort();
  });

  async ngOnInit() {
    // BR — dev notes solo se comparten con desarrolladores (Tecnología/programación).
    this.notasSvc.getDirectorioDesarrolladores().then((d) => this.directorio.set(d)).catch(() => {});
    await this.recargar();
  }

  private async recargar() {
    this.loading.set(true);
    const miId = this.userService.profile()?.id;
    if (!miId) { this.loading.set(false); return; }
    try {
      const [mias, comp] = await Promise.all([
        this.notasSvc.getMisNotas(miId, true, 'dev'),
        this.notasSvc.getCompartidasConmigo(miId, 'dev'),
      ]);
      this.mias.set(mias);
      this.compartidas.set(comp);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudieron cargar las notas');
    } finally {
      this.loading.set(false);
    }
  }

  abrir(n: Nota) {
    this.activa.set(n);
    this.titulo.set(n.titulo ?? '');
    this.contenido.set(n.contenido ?? '');
    this.tags.set([...(n.tags ?? [])]);
    this.lastUpdatedAt = n.updated_at;
    this.persistida.set(true);
    this.compartirUsuario.set(null);
    this.compartidos.set([]);
    void this.cargarCompartidos(n.id);
  }

  nueva() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const miId = this.userService.profile()?.id ?? '';
    const n: Nota = {
      id, owner_id: miId, titulo: '', contenido: '', color: null, pinned: false,
      archivada: false, created_at: now, updated_at: now, ambito: 'dev', formato: 'markdown', tags: [],
    };
    this.activa.set(n);
    this.titulo.set('');
    this.contenido.set('');
    this.tags.set([]);
    this.lastUpdatedAt = null;
    this.persistida.set(false);
    this.compartidos.set([]);
    this.compartirUsuario.set(null);
  }

  cerrarEditor() { this.activa.set(null); }

  addTag() {
    const t = this.nuevoTag().trim().toLowerCase();
    if (t && !this.tags().includes(t)) this.tags.update((l) => [...l, t]);
    this.nuevoTag.set('');
  }
  quitarTag(t: string) { this.tags.update((l) => l.filter((x) => x !== t)); }

  insertarPlantilla() { this.contenido.set(this.contenido() + (this.contenido() ? '\n\n' : '') + HANDOFF_TPL); }

  async guardar() {
    const n = this.activa();
    if (!n || this.soloLectura() || this.guardando()) return;
    this.guardando.set(true);
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id: n.id, titulo: this.titulo().trim(), contenido: this.contenido(),
          color: n.color, pinned: n.pinned, archivada: n.archivada,
          ambito: 'dev', formato: 'markdown', tags: this.tags(),
        },
        this.lastUpdatedAt,
      );
      this.lastUpdatedAt = res.nota.updated_at;
      this.activa.set(res.nota);
      this.persistida.set(true);
      if (res.conflict) this.toast.info('Guardado', 'Otro editó esta nota antes; se conservó tu versión.');
      else this.toast.success('Guardado');
      await this.recargar();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar() {
    const n = this.activa();
    if (!n) return;
    try {
      await this.notasSvc.eliminarNota(n.id);
      this.activa.set(null);
      await this.recargar();
      this.toast.success('Nota eliminada');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo eliminar');
    }
  }

  async togglePin() {
    const n = this.activa();
    if (!n) return;
    n.pinned = !n.pinned;
    this.activa.set({ ...n });
    await this.guardar();
  }

  exportarMd() {
    const nombre = (this.titulo().trim() || 'dev-note').replace(/[^\w.-]+/g, '-');
    const blob = new Blob([this.contenido()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${nombre}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async importarMd(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const texto = await file.text();
    if (!this.activa()) this.nueva();
    if (!this.titulo().trim()) this.titulo.set(file.name.replace(/\.(md|txt)$/i, ''));
    this.contenido.set(this.contenido() ? this.contenido() + '\n\n' + texto : texto);
    input.value = '';
  }

  // ── Compartir (mismo flujo que /notas; la RLS 'dev' limita la visibilidad a
  //    Tecnología aunque se comparta con alguien que no lo sea) ────────────────
  private async cargarCompartidos(notaId: string) {
    try {
      this.compartidos.set(await this.notasSvc.getCompartidos(notaId));
    } catch {
      this.compartidos.set([]); // solo el dueño puede leerlos
    }
  }

  async agregarCompartido() {
    const usuarioId = this.compartirUsuario();
    const n = this.activa();
    if (!usuarioId || !n || !this.puedeCompartir()) return;
    try {
      await this.notasSvc.compartir(n.id, usuarioId, this.compartirPermiso());
      this.compartirUsuario.set(null);
      await this.cargarCompartidos(n.id);
      this.toast.success('Nota compartida');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo compartir');
    }
  }

  async cambiarPermiso(c: NotaCompartido, permiso: NotaPermiso) {
    const n = this.activa();
    if (!n || c.permiso === permiso) return;
    try {
      await this.notasSvc.cambiarPermiso(n.id, c.usuario_id, permiso);
      await this.cargarCompartidos(n.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo cambiar el permiso');
    }
  }

  async quitarCompartido(c: NotaCompartido) {
    const n = this.activa();
    if (!n) return;
    try {
      await this.notasSvc.quitarCompartido(n.id, c.usuario_id);
      await this.cargarCompartidos(n.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo quitar el acceso');
    }
  }

  // ── BP5 — mover de vuelta a /notas (ambito='general') ──────────────────────
  async moverANotas() {
    const n = this.activa();
    if (!n || !this.puedeCompartir() || this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.notasSvc.guardarNota(
        {
          id: n.id, titulo: this.titulo().trim(), contenido: this.contenido(),
          color: n.color, pinned: n.pinned, archivada: n.archivada,
          ambito: 'general', formato: 'markdown', tags: this.tags(),
        },
        this.lastUpdatedAt,
      );
      this.toast.success('Movida a Notas');
      this.router.navigate(['/notas']);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo mover a Notas');
    } finally {
      this.guardando.set(false);
    }
  }
}
