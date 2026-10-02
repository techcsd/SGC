import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { PersonalCarnet } from './personal-carnet';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import {
  PersonalObra,
  PersonalFirma,
  FirmaLinea,
  FirmaRol,
  FIRMA_ROL_LABEL,
  FOTOS_GUIA,
  FotoTipo,
  NACIONALIDAD_LABEL,
  ASEGURAMIENTO_ESTADOS,
  AseguramientoEstado,
} from '../../../../shared/models/personal-obra.model';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';
import { formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { UserService } from '../../../core/services/user.service';

/** AR1 — Expediente completo del personal: datos, galería, carnet e historial. */
@Component({
  selector: 'app-personal-expediente',
  imports: [RouterLink, Skeleton, Lightbox, PersonalCarnet, FormDrawer, SignaturePad],
  templateUrl: './personal-expediente.html',
  styleUrl: './personal-expediente.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalExpediente implements OnInit {
  private service = inject(PersonalObraService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userService = inject(UserService);

  readonly fotosGuia = FOTOS_GUIA;
  readonly nacionalidadLabel = NACIONALIDAD_LABEL;
  readonly aseguramientoEstados = ASEGURAMIENTO_ESTADOS;
  readonly formatFecha = formatFechaHumana;

  // AV4 — edición del aseguramiento.
  editandoAseg = signal(false);

  carnet = viewChild(PersonalCarnet);

  personal = signal<PersonalObra | null>(null);
  fotos = signal<Record<FotoTipo, string>>({} as Record<FotoTipo, string>);
  personaDataUrl = signal<string | null>(null);
  firmas = signal<PersonalFirma[]>([]);
  firmaUrls = signal<Record<string, string>>({}); // CE8 — firma.id → URL firmada
  // CF1 — líneas de firma por rol (firma_id → líneas) + URLs firmadas de cada línea.
  readonly rolLabel = FIRMA_ROL_LABEL;
  readonly ordenRoles: FirmaRol[] = ['empleador', 'trabajador', 'testigo_1', 'testigo_2'];
  lineas = signal<Record<string, FirmaLinea[]>>({});
  lineaUrls = signal<Record<string, string>>({}); // linea.id → URL firmada (pad/foto)
  esLegalOAdmin = computed(() => this.esAdmin() || this.userService.hasRole('legal') || this.userService.hasRole('abogado'));
  // Drawer de "firmar línea" (empleador/testigo).
  firmarCtx = signal<{ firma: PersonalFirma; rol: FirmaRol } | null>(null);
  firmarMetodo = signal<'pad' | 'fisico'>('pad');
  firmanteNombre = signal('');
  firmanteCedula = signal('');
  firmarFile = signal<File | null>(null);
  firmarBusy = signal(false);
  firmarError = signal('');
  linePad = viewChild<SignaturePad>('linePad');
  // CE9 — acciones de admin (marcar prueba / eliminar).
  esAdmin = computed(() => this.userService.hasRole('admin'));
  confirmarEliminar = signal(false);
  nombreConfirmacion = signal('');
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  lightboxUrl = signal<string | null>(null);
  // AZ1 — documento firmado (snapshot congelado) que se está viendo.
  docVer = signal<PersonalFirma | null>(null);

  // AX2 — acceso al sistema por cédula del capataz.
  accesoPin = signal('');
  accesoBusy = signal(false);
  accesoMsg = signal('');
  accesoError = signal('');
  esCapataz = computed(() => this.personal()?.cargo?.codigo === 'CAP');
  tieneAcceso = computed(() => !!this.personal()?.usuario_id);
  // BI6 — gestionar el PIN pasó a ser de admin/tecnología (la edge acceso-cedula ya lo
  // exige). Regla 4: no pintar el botón a quien la edge va a rechazar.
  puedeGestionarAcceso = computed(() => this.userService.esTecnologia());

  async crearAccesoCapataz() {
    const p = this.personal();
    if (!p || this.accesoBusy()) return;
    const pin = this.accesoPin().trim();
    if (!/^\d{6}$/.test(pin)) { this.accesoError.set('El PIN debe tener exactamente 6 dígitos.'); return; }
    if (!p.documento_numero) { this.accesoError.set('La ficha no tiene cédula/documento para el acceso.'); return; }
    this.accesoBusy.set(true); this.accesoError.set(''); this.accesoMsg.set('');
    try {
      const { email } = await this.service.generarAccesoCapataz(p.id, pin);
      this.accesoMsg.set(`Acceso listo — inicia sesión en la app con la cédula ${p.documento_numero} y el PIN. (${email})`);
      this.accesoPin.set('');
      await this.load(p.id); // refresca usuario_id
    } catch (e: unknown) {
      this.accesoError.set(e instanceof Error ? e.message : 'No se pudo crear el acceso.');
    } finally {
      this.accesoBusy.set(false);
    }
  }

  get verifyUrl(): string {
    const p = this.personal();
    // CE5 — el QR del carnet apunta a la verificación pública por número de carnet.
    return p?.carnet_numero ? `${window.location.origin}/verificar/${p.carnet_numero}` : '';
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.error.set('Personal no encontrado.'); this.loading.set(false); return; }
    await this.load(id);
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const p = await this.service.getById(id);
      if (!p) { this.error.set('Personal no encontrado o sin acceso.'); return; }
      this.personal.set(p);
      const [fotos, firmas] = await Promise.all([
        this.service.getFotos(id),
        this.service.getFirmas(id),
      ]);
      this.firmas.set(firmas);
      const urls: Record<string, string> = {};
      for (const f of fotos) urls[f.tipo] = await this.service.fotoUrl(f.foto_path);
      this.fotos.set(urls as Record<FotoTipo, string>);
      // CE8 — URL firmada de cada firma para poder incrustarla en el documento.
      const fUrls: Record<string, string> = {};
      for (const f of firmas) {
        if (f.firma_path) fUrls[f.id] = await this.service.firmaUrl(f.firma_path);
      }
      this.firmaUrls.set(fUrls);
      await this.cargarLineas(firmas);
      // Foto de la persona → dataURL para el carnet imprimible.
      const persona = fotos.find((f) => f.tipo === 'persona');
      if (persona) this.personaDataUrl.set(await this.fetchDataUrl(urls['persona']));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el expediente.');
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchDataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((r) => {
        const fr = new FileReader();
        fr.onloadend = () => r(typeof fr.result === 'string' ? fr.result : null);
        fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  async emitirCarnet() {
    const p = this.personal();
    if (!p) return;
    this.saving.set(true);
    try {
      const num = await this.service.emitirCarnet(p.id);
      this.personal.set({ ...p, carnet_numero: num, carnet_emitido_at: new Date().toISOString() });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo emitir el carnet.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleEstado() {
    const p = this.personal();
    if (!p) return;
    const nuevo = p.estado === 'activo' ? 'inactivo' : 'activo';
    this.saving.set(true);
    try {
      await this.service.actualizar(p.id, { estado: nuevo });
      this.personal.set({ ...p, estado: nuevo });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    } finally {
      this.saving.set(false);
    }
  }

  async imprimirCarnet() {
    const p = this.personal();
    if (!p) return;
    // CE5 — registra la reimpresión (rastro) y luego imprime.
    try { if (p.carnet_numero) await this.service.registrarReimpresion(p.id); } catch { /* no bloquea */ }
    void this.carnet()?.imprimir();
  }

  // CE9 — admin: marcar/desmarcar prueba.
  async togglePrueba() {
    const p = this.personal();
    if (!p) return;
    this.saving.set(true);
    try {
      await this.service.marcarPrueba(p.id, !p.es_prueba);
      this.personal.set({ ...p, es_prueba: !p.es_prueba });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cambiar la marca de prueba.');
    } finally { this.saving.set(false); }
  }

  // CE9 — admin: eliminar (lógico) tras escribir el nombre para confirmar.
  async eliminar() {
    const p = this.personal();
    if (!p) return;
    const nombreCompleto = `${p.nombre} ${p.apellido ?? ''}`.trim();
    if (this.nombreConfirmacion().trim() !== nombreCompleto) {
      this.error.set('Escribe el nombre completo para confirmar la eliminación.');
      return;
    }
    this.saving.set(true);
    try {
      await this.service.eliminar(p.id, 'Eliminado desde el expediente');
      this.router.navigate(['/proyectos/personal']);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo eliminar.');
    } finally { this.saving.set(false); }
  }

  /** AV4 — guarda el estado de aseguramiento (flag manual + fecha). */
  async guardarAseguramiento(estado: string, fecha: string) {
    const p = this.personal();
    if (!p) return;
    const est = estado as AseguramientoEstado;
    const f = fecha || null;
    this.saving.set(true);
    try {
      await this.service.actualizar(p.id, { aseguramiento_estado: est, aseguramiento_fecha: f });
      this.personal.set({ ...p, aseguramiento_estado: est, aseguramiento_fecha: f });
      this.editandoAseg.set(false);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo guardar el aseguramiento.');
    } finally {
      this.saving.set(false);
    }
  }

  editar() {
    const p = this.personal();
    if (p) this.router.navigate(['/proyectos/personal/registrar'], { queryParams: { id: p.id } });
  }

  // ── CF1 — líneas de firma por rol ──────────────────────────────────────────
  private async cargarLineas(firmas: PersonalFirma[]) {
    const map: Record<string, FirmaLinea[]> = {};
    const urls: Record<string, string> = {};
    for (const f of firmas) {
      const ls = await this.service.lineasFirma(f.id);
      map[f.id] = ls;
      for (const l of ls) {
        if (l.firma_path && l.metodo !== 'fisico') {
          try { urls[l.id] = await this.service.firmaUrl(l.firma_path); } catch { /* opcional */ }
        }
      }
    }
    this.lineas.set(map);
    this.lineaUrls.set(urls);
  }

  lineasDe(firmaId: string): FirmaLinea[] {
    const ls = this.lineas()[firmaId] ?? [];
    return [...ls].sort((a, b) => this.ordenRoles.indexOf(a.rol) - this.ordenRoles.indexOf(b.rol));
  }

  estadoLineaTxt(l: FirmaLinea): string {
    if (l.estado === 'firmado') return 'Firmada';
    if (l.estado === 'papel') return 'Firmada en papel';
    return 'Pendiente';
  }
  estadoLineaClase(l: FirmaLinea): string {
    if (l.estado === 'firmado') return 'sgc-badge sgc-badge--success';
    if (l.estado === 'papel') return 'sgc-badge sgc-badge--neutral';
    return 'sgc-badge sgc-badge--warning';
  }

  abrirFirmarLinea(f: PersonalFirma, rol: FirmaRol) {
    this.firmarCtx.set({ firma: f, rol });
    this.firmarMetodo.set('pad');
    this.firmanteNombre.set('');
    this.firmanteCedula.set('');
    this.firmarFile.set(null);
    this.firmarError.set('');
  }
  cerrarFirmarLinea() { this.firmarCtx.set(null); }

  onFirmarFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.firmarFile.set(file);
  }

  esTestigo(rol: FirmaRol | undefined): boolean { return rol === 'testigo_1' || rol === 'testigo_2'; }

  async guardarFirmarLinea() {
    const ctx = this.firmarCtx();
    const p = this.personal();
    if (!ctx || !p || this.firmarBusy()) return;
    const metodo = this.firmarMetodo();
    let blob: Blob | null = null;
    if (metodo === 'pad') {
      const pad = this.linePad();
      if (!pad || pad.isEmpty()) { this.firmarError.set('Dibuja la firma antes de continuar.'); return; }
      blob = await pad.toBlob();
      if (!blob) { this.firmarError.set('No se pudo capturar la firma.'); return; }
    } else {
      const file = this.firmarFile();
      if (!file) { this.firmarError.set('Sube la foto o el PDF de la página firmada.'); return; }
      blob = file.type.includes('pdf') ? file : await comprimirImagen(file, 'documento');
    }
    this.firmarBusy.set(true);
    this.firmarError.set('');
    try {
      await this.service.firmarLinea(ctx.firma, p, ctx.rol, metodo, {
        firma: blob,
        nombre: this.esTestigo(ctx.rol) ? this.firmanteNombre().trim() || null : null,
        cedula: this.esTestigo(ctx.rol) ? this.firmanteCedula().trim() || null : null,
      });
      await this.cargarLineas(this.firmas());
      this.firmarCtx.set(null);
    } catch (e: unknown) {
      this.firmarError.set(e instanceof Error ? e.message : 'No se pudo registrar la firma.');
    } finally {
      this.firmarBusy.set(false);
    }
  }

  // AZ1 — abre el documento firmado con los valores congelados al momento de la firma.
  verDoc(f: PersonalFirma) {
    if (f.documento_html) this.docVer.set(f);
  }

  /** CE8 — HTML del documento con la(s) firma(s) incrustada(s) bajo su línea. */
  docVerHtml = computed(() => {
    const f = this.docVer();
    if (!f?.documento_html) return '';
    return this.docConFirma(f);
  });

  private docConFirma(f: PersonalFirma): string {
    // CF1 — renderiza TODAS las líneas de firma (empleador/trabajador/testigos) con su estado.
    const lineas = this.lineasDe(f.id);
    const celdas = (lineas.length ? lineas : [{ id: f.id, rol: 'trabajador', estado: 'firmado', metodo: f.metodo, firma_path: f.firma_path, firmante_nombre: null, firmante_cedula: null, firmado_por: null, firmado_at: f.firmado_at } as FirmaLinea])
      .map((l) => {
        const url = l.rol === 'trabajador' && this.firmaUrls()[f.id] ? this.firmaUrls()[f.id] : this.lineaUrls()[l.id];
        const img = l.estado !== 'pendiente' && url
          ? `<img src="${url}" alt="Firma" style="max-height:80px;display:block;margin-bottom:4px;" />`
          : `<div style="height:80px;"></div>`;
        const estadoTxt = l.estado === 'firmado' ? (l.firmado_at ? this.formatFecha(l.firmado_at) : 'Firmada')
          : l.estado === 'papel' ? 'Firmada en papel' : 'Pendiente de firma';
        const nombre = this.esTestigo(l.rol) && l.firmante_nombre
          ? `${l.firmante_nombre}${l.firmante_cedula ? ' · ' + l.firmante_cedula : ''}` : '';
        return `<td style="padding:10px 18px;vertical-align:bottom;text-align:center;">
            ${img}
            <div style="border-top:1px solid #333;padding-top:4px;font-size:12px;">
              <strong>${this.rolLabel[l.rol]}</strong><br/>${nombre ? nombre + '<br/>' : ''}<span style="color:#555;">${estadoTxt}</span>
            </div>
          </td>`;
      }).join('');
    const firmaBloque = `<div style="margin-top:32px;page-break-inside:avoid;">
        <table style="width:100%;border-collapse:collapse;"><tr>${celdas}</tr></table>
      </div>`;
    return `${f.documento_html ?? ''}${firmaBloque}`;
  }

  imprimirDoc() {
    const f = this.docVer();
    if (!f?.documento_html) return;
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${f.documento_nombre}</title></head><body>${this.docConFirma(f)}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }
}
