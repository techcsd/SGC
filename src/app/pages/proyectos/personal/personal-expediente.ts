import { Component, ChangeDetectionStrategy, inject, signal, OnInit, viewChild } from '@angular/core';
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
}
