import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
  effect,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClLiberacionService } from '../../services/cl-liberacion.service';
import { ObraEjecucionService } from '../../services/obra-ejecucion.service';
import { ToastService } from '../../services/toast.service';
import { SignaturePad } from '../../ui/signature-pad/signature-pad';
import { formatFechaDisplay } from '../../utils/fecha.util';
import { ObraElemento, ObraVaciado } from '../../models/obra-ejecucion.model';
import {
  ClPlantilla,
  ClPlantillaItem,
  ClRegistro,
  ClRegistroItem,
  CL_FIRMA_ROLES,
  CL_ESTADOS,
} from '../../models/cl-liberacion.model';

interface ItemForm extends ClRegistroItem {
  seccion: string | null;
}

/**
 * CSD-OPE-01 §6.8/§9 — Checklists de Liberación (CL-01..07).
 * Llenar el checklist por secciones, mapear el plano + fotos y recorrer el ciclo
 * de firmas (Maestro → Residente → Responsable → Cliente/MIVHED). Al completar las
 * firmas obligatorias la BD marca el CL como firmado y habilita liberar el vaciado.
 */
@Component({
  selector: 'app-cl-liberacion',
  imports: [FormsModule, SignaturePad],
  templateUrl: './cl-liberacion.html',
  styleUrl: './cl-liberacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClLiberacion {
  proyectoId = input.required<string>();
  /** Q5/Q2 — CL a enfocar/expandir al abrir (deep-link desde una notificación). */
  focusRegistroId = input<string | null>(null);
  /** S14 — rol pedido en la solicitud de firma (se pre-selecciona al abrir). */
  focusFirmaRol = input<string | null>(null);

  private service = inject(ClLiberacionService);
  private obra = inject(ObraEjecucionService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;
  readonly CL_FIRMA_ROLES = CL_FIRMA_ROLES;
  readonly CL_ESTADOS = CL_ESTADOS;

  // ── Data ───────────────────────────────────────────────────
  plantillas = signal<ClPlantilla[]>([]);
  elementos = signal<ObraElemento[]>([]);
  vaciados = signal<ObraVaciado[]>([]);
  registros = signal<ClRegistro[]>([]);
  loading = signal(true);
  error = signal('');

  // Firma URLs y plano/fotos resueltos (path → signed url)
  mediaUrls = signal<Record<string, string>>({});

  // ── Create form ────────────────────────────────────────────
  showForm = signal(false);
  fPlantillaId = signal<string | null>(null);
  fElementoId = signal<string | null>(null);
  fVaciadoId = signal<string | null>(null);
  fBloque = signal('');
  fEje = signal('');
  fObservaciones = signal('');
  fItems = signal<ItemForm[]>([]);
  fPlanoFile = signal<File | null>(null);
  saving = signal(false);
  formError = signal('');

  // Ítems agrupados por sección (para el template)
  itemsPorSeccion = computed(() => {
    const groups = new Map<string, ItemForm[]>();
    for (const it of this.fItems()) {
      const key = it.seccion || 'General';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    return Array.from(groups.entries()).map(([seccion, items]) => ({ seccion, items }));
  });

  // ── Expanded registro (ver / firmar) ───────────────────────
  expandedId = signal<string | null>(null);

  // Firma panel
  firmaRol = signal<string | null>(null);
  firmaNombre = signal('');
  firmaSaving = signal(false);
  firmaError = signal('');
  // S14 — el pad/formulario de firma solo aparece tras revisar y pulsar "Firmar".
  mostrarFirma = signal(false);
  private pad = viewChild(SignaturePad);

  // Foto panel
  fotoCorrecto = signal<boolean>(true);
  fotoDescripcion = signal('');
  fotoSaving = signal(false);

  // Q5 — método de firma (pad | foto) y solicitud de firma
  firmaMetodo = signal<'pad' | 'foto'>('pad');
  firmaFotoFile = signal<File | null>(null);
  directorio = signal<{ id: string; nombre: string }[]>([]);
  solicitarAbierto = signal<string | null>(null); // registroId con el panel abierto
  solicitarUsuarioId = signal<string>('');
  solicitarRol = signal<string>('');
  solicitando = signal(false);

  constructor() {
    effect(() => {
      const id = this.proyectoId();
      if (id) this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [plantillas, elementos, vaciados, registros, directorio] = await Promise.all([
        this.service.getPlantillas(),
        this.obra.getElementos(id),
        this.obra.getVaciados(id),
        this.service.getRegistros(id),
        this.service.getDirectorio().catch(() => []),
      ]);
      this.plantillas.set(plantillas);
      this.elementos.set(elementos);
      this.vaciados.set(vaciados);
      this.registros.set(registros);
      this.directorio.set(directorio);
      this.resolveMedia(registros);
      // Q5/Q2 — deep-link: expandir el CL señalado por la notificación.
      const focus = this.focusRegistroId();
      if (focus && registros.some((r) => r.id === focus)) {
        this.expandedId.set(focus);
        // S14 — pre-selecciona el rol pedido, pero NO abre el pad: primero se
        // ve la revisión read-only y al final se pulsa "Firmar como {rol}".
        this.mostrarFirma.set(false);
        this.firmaRol.set(this.focusFirmaRol());
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los checklists.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resuelve URLs firmadas de planos, fotos y firmas para mostrarlas. */
  private async resolveMedia(registros: ClRegistro[]) {
    const paths = new Set<string>();
    for (const r of registros) {
      if (r.plano_path) paths.add(r.plano_path);
      for (const f of r.fotos ?? []) if (f.storage_path) paths.add(f.storage_path);
      for (const s of r.firmas ?? []) if (s.firma_path) paths.add(s.firma_path);
    }
    const entries = await Promise.all(
      [...paths].map(async (p) => [p, await this.service.getUrl(p)] as const),
    );
    const map: Record<string, string> = {};
    for (const [p, url] of entries) if (url) map[p] = url;
    this.mediaUrls.update((prev) => ({ ...prev, ...map }));
  }

  urlOf(path: string | null | undefined): string | null {
    if (!path) return null;
    return this.mediaUrls()[path] ?? null;
  }

  // ── Helpers de presentación ────────────────────────────────
  estadoLabel(v: string): string {
    return CL_ESTADOS.find((e) => e.value === v)?.label ?? v;
  }
  estadoBadge(v: string): string {
    return CL_ESTADOS.find((e) => e.value === v)?.badge ?? 'neutral';
  }
  rolLabel(v: string): string {
    return CL_FIRMA_ROLES.find((r) => r.value === v)?.label ?? v;
  }

  elementoLabel(id: string | null | undefined): string {
    if (!id) return '—';
    const el = this.elementos().find((e) => e.id === id);
    if (!el) return '—';
    return (
      [el.codigo, el.eje ? `eje ${el.eje}` : '', el.bloque ? `bloque ${el.bloque}` : '']
        .filter(Boolean)
        .join(' · ') || (el.tipo ?? '—')
    );
  }

  vaciadoLabel(id: string | null | undefined): string {
    if (!id) return '—';
    const v = this.vaciados().find((x) => x.id === id);
    if (!v) return '—';
    return `Vaciado #${v.numero ?? '?'}`;
  }

  /** Q5 — checklist visual de TODOS los roles: verde si firmó, gris si falta.
   *  Marca los obligatorios (residente/responsable) para el indicador. */
  firmasEstado(r: ClRegistro): { rol: string; label: string; firmado: boolean; obligatoria: boolean }[] {
    const firmados = new Set((r.firmas ?? []).map((f) => f.rol));
    return CL_FIRMA_ROLES.map((x) => ({
      rol: x.value,
      label: x.label,
      firmado: firmados.has(x.value),
      obligatoria: x.obligatoria,
    }));
  }

  /** Roles obligatorios que aún faltan por firmar (para el aviso de faltantes). */
  faltanObligatorias(r: ClRegistro): boolean {
    const firmados = new Set((r.firmas ?? []).map((f) => f.rol));
    return CL_FIRMA_ROLES.some((x) => x.obligatoria && !firmados.has(x.value));
  }

  itemsOk(r: ClRegistro): number {
    return (r.items ?? []).filter((i) => i.cumple === true).length;
  }

  // ── Create ─────────────────────────────────────────────────
  openForm() {
    this.resetForm();
    this.showForm.set(true);
  }
  cancelForm() {
    this.showForm.set(false);
  }
  private resetForm() {
    this.fPlantillaId.set(null);
    this.fElementoId.set(null);
    this.fVaciadoId.set(null);
    this.fBloque.set('');
    this.fEje.set('');
    this.fObservaciones.set('');
    this.fItems.set([]);
    this.fPlanoFile.set(null);
    this.formError.set('');
  }

  async onPlantillaChange(plantillaId: string | null) {
    this.fPlantillaId.set(plantillaId);
    this.fItems.set([]);
    if (!plantillaId) return;
    try {
      const items: ClPlantillaItem[] = await this.service.getPlantillaItems(plantillaId);
      this.fItems.set(
        items.map((i) => ({
          etiqueta: i.etiqueta,
          seccion: i.seccion,
          cumple: null,
          comentario: null,
          orden: i.orden ?? 0,
        })),
      );
    } catch (e: unknown) {
      this.formError.set(e instanceof Error ? e.message : 'Error al cargar los ítems.');
    }
  }

  setItemCumple(item: ItemForm, value: boolean) {
    this.fItems.update((list) =>
      list.map((i) => (i === item ? { ...i, cumple: i.cumple === value ? null : value } : i)),
    );
  }
  setItemComentario(item: ItemForm, comentario: string) {
    this.fItems.update((list) =>
      list.map((i) => (i === item ? { ...i, comentario: comentario || null } : i)),
    );
  }

  onPlanoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.fPlanoFile.set(input.files?.[0] ?? null);
  }

  async guardar() {
    if (this.saving()) return;
    const plantillaId = this.fPlantillaId();
    if (!plantillaId) {
      this.formError.set('Selecciona el tipo de checklist (CL).');
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    try {
      let planoPath: string | null = null;
      const plano = this.fPlanoFile();
      if (plano) {
        const ext = plano.name.split('.').pop()?.toLowerCase() || 'jpg';
        planoPath = await this.service.uploadTmp('plano', plano, ext);
      }
      const created = await this.service.crearRegistro(
        this.proyectoId(),
        {
          plantilla_id: plantillaId,
          elemento_id: this.fElementoId(),
          vaciado_id: this.fVaciadoId(),
          bloque: this.fBloque().trim() || null,
          eje: this.fEje().trim() || null,
          observaciones: this.fObservaciones().trim() || null,
        },
        this.fItems(),
        planoPath,
      );
      this.registros.update((list) => [created, ...list]);
      this.resolveMedia([created]);
      this.showForm.set(false);
      this.expandedId.set(created.id);
      this.toast.success('Checklist creado', 'Ahora recoge las firmas del ciclo de liberación.');
    } catch (e: unknown) {
      this.formError.set(e instanceof Error ? e.message : 'Error al crear el checklist.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Expand / firmar ────────────────────────────────────────
  toggleExpand(id: string) {
    this.expandedId.update((cur) => (cur === id ? null : id));
    this.resetFirmaPanel();
  }
  private resetFirmaPanel() {
    this.firmaRol.set(null);
    this.firmaNombre.set('');
    this.firmaError.set('');
    this.firmaMetodo.set('pad');
    this.firmaFotoFile.set(null);
    this.mostrarFirma.set(false);
    this.pad()?.clear();
  }

  /** S14 — revela el formulario/pad de firma tras la revisión read-only. */
  iniciarFirma() {
    this.mostrarFirma.set(true);
  }
  /** S14 — vuelve a la revisión sin firmar. */
  cancelarFirma() {
    this.mostrarFirma.set(false);
    this.firmaError.set('');
    this.pad()?.clear();
  }

  /** Q5 — al elegir el rol, si no admite foto, forzar método 'pad'. */
  onFirmaRolChange(rol: string | null) {
    this.firmaRol.set(rol);
    if (!this.rolAdmiteFoto(rol)) this.firmaMetodo.set('pad');
  }

  rolAdmiteFoto(rol: string | null | undefined): boolean {
    return !!CL_FIRMA_ROLES.find((x) => x.value === rol)?.foto;
  }

  setFirmaMetodo(m: 'pad' | 'foto') {
    this.firmaMetodo.set(m);
    this.firmaError.set('');
  }

  onFirmaFotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.firmaFotoFile.set(input.files?.[0] ?? null);
  }

  async guardarFirma(r: ClRegistro) {
    if (this.firmaSaving()) return;
    const rol = this.firmaRol();
    if (!rol) {
      this.firmaError.set('Selecciona el rol que firma.');
      return;
    }

    // Q5 — firma por foto (cliente/MIVHED) o firma dibujada en el pad.
    const metodo = this.firmaMetodo();
    let blob: Blob | null = null;
    let ext = 'png';
    if (metodo === 'foto') {
      const file = this.firmaFotoFile();
      if (!file) {
        this.firmaError.set('Selecciona la foto de la firma antes de guardar.');
        return;
      }
      blob = file;
      ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    } else {
      const pad = this.pad();
      blob = pad ? await pad.toBlob() : null;
      if (!blob) {
        this.firmaError.set('Captura la firma antes de guardar.');
        return;
      }
    }

    this.firmaSaving.set(true);
    this.firmaError.set('');
    try {
      const firmaPath = await this.service.upload(r.id, 'firma', blob, ext);
      const orden = CL_FIRMA_ROLES.findIndex((x) => x.value === rol);
      await this.service.addFirma(r.id, rol, this.firmaNombre().trim() || null, firmaPath, orden, metodo);
      // Recargar el registro (el trigger pudo pasarlo a 'firmado').
      const fresh = await this.service.getRegistro(r.id);
      this.registros.update((list) => list.map((x) => (x.id === r.id ? fresh : x)));
      this.resolveMedia([fresh]);
      this.resetFirmaPanel();
      const done = fresh.estado === 'firmado';
      this.toast.success(
        done ? 'Checklist firmado' : 'Firma registrada',
        done ? 'El vaciado ya puede liberarse.' : this.rolLabel(rol),
      );
    } catch (e: unknown) {
      this.firmaError.set(e instanceof Error ? e.message : 'Error al guardar la firma.');
    } finally {
      this.firmaSaving.set(false);
    }
  }

  // ── Q5 — Solicitar firma dentro de la plataforma ───────────
  toggleSolicitar(registroId: string) {
    this.solicitarAbierto.update((cur) => (cur === registroId ? null : registroId));
    this.solicitarUsuarioId.set('');
    this.solicitarRol.set('');
  }

  async solicitarFirma(r: ClRegistro) {
    if (this.solicitando()) return;
    const usuarioId = this.solicitarUsuarioId();
    const rol = this.solicitarRol();
    if (!usuarioId || !rol) {
      this.toast.error('Faltan datos', 'Elige el usuario y el rol de la firma solicitada.');
      return;
    }
    this.solicitando.set(true);
    try {
      await this.service.solicitarFirma(
        usuarioId,
        this.proyectoId(),
        r.id,
        r.plantilla?.codigo ?? 'CL',
        r.plantilla?.nombre ?? 'checklist de liberación',
        this.rolLabel(rol),
        rol,
      );
      this.solicitarAbierto.set(null);
      this.toast.success('Firma solicitada', 'Le llegará una notificación para revisar y firmar.');
    } catch (e: unknown) {
      this.toast.error('No se pudo solicitar', e instanceof Error ? e.message : undefined);
    } finally {
      this.solicitando.set(false);
    }
  }

  // ── Fotos (correcto / incorrecto) ──────────────────────────
  async onFotoSelected(event: Event, r: ClRegistro) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.fotoSaving()) return;
    this.fotoSaving.set(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = await this.service.upload(r.id, 'foto', file, ext);
      await this.service.addFoto(r.id, path, this.fotoCorrecto(), this.fotoDescripcion().trim() || null);
      const fresh = await this.service.getRegistro(r.id);
      this.registros.update((list) => list.map((x) => (x.id === r.id ? fresh : x)));
      this.resolveMedia([fresh]);
      this.fotoDescripcion.set('');
      this.toast.success('Foto agregada');
    } catch (e: unknown) {
      this.toast.error('No se pudo subir la foto', e instanceof Error ? e.message : undefined);
    } finally {
      this.fotoSaving.set(false);
      input.value = '';
    }
  }

  rolYaFirmado(r: ClRegistro, rol: string): boolean {
    return (r.firmas ?? []).some((f) => f.rol === rol);
  }
}
