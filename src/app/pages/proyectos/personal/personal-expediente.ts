import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { PersonalCarnet } from './personal-carnet';
import {
  PersonalObra,
  PersonalFirma,
  FOTOS_GUIA,
  FotoTipo,
  NACIONALIDAD_LABEL,
  ASEGURAMIENTO_ESTADOS,
  AseguramientoEstado,
} from '../../../../shared/models/personal-obra.model';
import { formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { UserService } from '../../../core/services/user.service';

/** AR1 — Expediente completo del personal: datos, galería, carnet e historial. */
@Component({
  selector: 'app-personal-expediente',
  imports: [RouterLink, Skeleton, Lightbox, PersonalCarnet],
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
    return p ? `${window.location.origin}/proyectos/personal/${p.id}` : '';
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

  imprimirCarnet() {
    void this.carnet()?.imprimir();
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

  // AZ1 — abre el documento firmado con los valores congelados al momento de la firma.
  verDoc(f: PersonalFirma) {
    if (f.documento_html) this.docVer.set(f);
  }

  imprimirDoc() {
    const f = this.docVer();
    if (!f?.documento_html) return;
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${f.documento_nombre}</title></head><body>${f.documento_html}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }
}
