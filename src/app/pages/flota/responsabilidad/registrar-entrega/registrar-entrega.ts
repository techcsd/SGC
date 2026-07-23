import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  output,
  viewChild,
  OnInit,
} from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  VehiculosService,
  EntregaAbierta,
  HandoverRequeridoError,
} from '../../../../../shared/services/vehiculos.service';
import { UserService } from '../../../../core/services/user.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { Vehiculo } from '../../../../../shared/models/vehiculo.model';
import { NIVEL_COMBUSTIBLE_OPCIONES } from '../../../../../shared/models/flota-checklist.model';
import { VehiculoPicker } from '../../../../../shared/components/vehiculo-picker/vehiculo-picker';
import { SignaturePad } from '../../../../../shared/ui/signature-pad/signature-pad';
import { comprimirImagen } from '../../../../../shared/utils/comprimir-imagen.util';

interface DanoEdit {
  zona: string;
  descripcion: string;
  file: File | null;
  preview: string | null;
}

/** Slots de foto obligatorios que exige crear_entrega_vehiculo (servidor los valida). */
const ENTREGA_SLOTS: { slot: string; label: string }[] = [
  { slot: 'frente', label: 'Frente' },
  { slot: 'atras', label: 'Atrás' },
  { slot: 'lado_izq', label: 'Lado izquierdo' },
  { slot: 'lado_der', label: 'Lado derecho' },
  { slot: 'tablero', label: 'Tablero' },
  { slot: 'combustible', label: 'Combustible' },
];

/**
 * Registro web de entrega/recepción de vehículo (paridad con la app de campo).
 * Usa crear_entrega_vehiculo: el usuario actual queda como conductor, exige las 6
 * fotos guiadas, y opcionalmente daños, firma y GPS del navegador.
 */
@Component({
  selector: 'app-registrar-entrega',
  imports: [DecimalPipe, DatePipe, ReactiveFormsModule, VehiculoPicker, SignaturePad],
  templateUrl: './registrar-entrega.html',
  styleUrl: './registrar-entrega.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistrarEntrega implements OnInit {
  private vehiculosService = inject(VehiculosService);
  private user = inject(UserService);
  private toast = inject(ToastService);

  creada = output<void>();
  cancelar = output<void>();

  readonly SLOTS = ENTREGA_SLOTS;
  readonly NIVELES = NIVEL_COMBUSTIBLE_OPCIONES;

  vehiculos = signal<Vehiculo[]>([]);
  saving = signal(false);
  error = signal('');

  // W3 — pre-check: recepción abierta de otro conductor sobre el vehículo elegido.
  entregaAbierta = signal<EntregaAbierta | null>(null);
  checkingAbierta = signal(false);
  /** Cuando el server pide handover: guardamos el payload ya subido para reintentar. */
  private handoverPendiente: Parameters<VehiculosService['crearEntrega']>[0] | null = null;
  handoverInfo = signal<EntregaAbierta | null>(null);
  get esFlotaElevado() {
    return this.user.esFlotaElevado();
  }

  private slotFotos = signal<Record<string, File>>({});
  slotPreviews = signal<Record<string, string>>({});

  tieneDanos = signal(false);
  danos = signal<DanoEdit[]>([]);

  gps = signal<{ lat: number; lng: number } | null>(null);
  gpsMsg = signal('');
  capturandoGps = signal(false);

  private firmaPad = viewChild<SignaturePad>('firmaPad');

  form = new FormGroup({
    vehiculo_id: new FormControl<string | null>(null, [Validators.required]),
    tipo: new FormControl<'recepcion' | 'devolucion'>('recepcion', [Validators.required]),
    km: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    combustible: new FormControl<string | null>(null, [Validators.required]),
    observacion: new FormControl<string | null>(null),
  });

  fotosCompletas = computed(() => {
    const map = this.slotPreviews();
    return this.SLOTS.every((s) => !!map[s.slot]);
  });

  async ngOnInit() {
    try {
      // Solo vehículos operables (no dados de baja).
      const list = await this.vehiculosService.getAll();
      this.vehiculos.set(list.filter((v) => v.estado !== 'baja'));
    } catch {
      /* el picker queda vacío si falla */
    }
    // W3 — al elegir vehículo/tipo, avisar ANTES de llenar si ya está entregado.
    this.form.controls.vehiculo_id.valueChanges.subscribe(() => void this.precheckAbierta());
    this.form.controls.tipo.valueChanges.subscribe(() => void this.precheckAbierta());
  }

  setTipo(tipo: 'recepcion' | 'devolucion') {
    this.form.controls.tipo.setValue(tipo);
  }

  /** W3 — pre-check online: ¿el vehículo ya tiene una recepción abierta? */
  private async precheckAbierta() {
    this.entregaAbierta.set(null);
    const vehiculoId = this.form.controls.vehiculo_id.value;
    // Solo aplica al RECIBIR (la devolución sí necesita una entrega abierta).
    if (!vehiculoId || this.form.controls.tipo.value !== 'recepcion') return;
    this.checkingAbierta.set(true);
    try {
      const info = await this.vehiculosService.entregaAbiertaDe(vehiculoId);
      // Solo avisamos si es de OTRO conductor (la propia es un no-op idempotente).
      this.entregaAbierta.set(info && !info.es_mia ? info : null);
    } catch {
      /* best-effort: si falla el pre-check, el server igual valida al guardar */
    } finally {
      this.checkingAbierta.set(false);
    }
  }

  // ── Fotos guiadas ──
  async onSlotFoto(slot: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const comprimida = await comprimirImagen(file);
    const prev = this.slotPreviews()[slot];
    if (prev) URL.revokeObjectURL(prev);
    this.slotFotos.update((m) => ({ ...m, [slot]: comprimida }));
    this.slotPreviews.update((m) => ({ ...m, [slot]: URL.createObjectURL(comprimida) }));
  }

  quitarSlotFoto(slot: string) {
    const prev = this.slotPreviews()[slot];
    if (prev) URL.revokeObjectURL(prev);
    this.slotFotos.update((m) => {
      const { [slot]: _o, ...rest } = m;
      return rest;
    });
    this.slotPreviews.update((m) => {
      const { [slot]: _o, ...rest } = m;
      return rest;
    });
  }

  slotPreview(slot: string): string | null {
    return this.slotPreviews()[slot] ?? null;
  }

  // ── Daños ──
  toggleDanos() {
    const next = !this.tieneDanos();
    this.tieneDanos.set(next);
    if (next && this.danos().length === 0) this.addDano();
    if (!next) this.danos.set([]);
  }

  addDano() {
    this.danos.update((list) => [...list, { zona: '', descripcion: '', file: null, preview: null }]);
  }

  removeDano(i: number) {
    const d = this.danos()[i];
    if (d?.preview) URL.revokeObjectURL(d.preview);
    this.danos.update((list) => list.filter((_, idx) => idx !== i));
  }

  updateDano(i: number, campo: 'zona' | 'descripcion', valor: string) {
    this.danos.update((list) => list.map((d, idx) => (idx === i ? { ...d, [campo]: valor } : d)));
  }

  async onDanoFoto(i: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const comprimida = await comprimirImagen(file);
    this.danos.update((list) =>
      list.map((d, idx) => {
        if (idx !== i) return d;
        if (d.preview) URL.revokeObjectURL(d.preview);
        return { ...d, file: comprimida, preview: URL.createObjectURL(comprimida) };
      }),
    );
  }

  // ── GPS ──
  capturarGps() {
    if (!navigator.geolocation) {
      this.gpsMsg.set('Este navegador no permite ubicación.');
      return;
    }
    this.capturandoGps.set(true);
    this.gpsMsg.set('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.gps.set({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        this.gpsMsg.set('Ubicación capturada.');
        this.capturandoGps.set(false);
      },
      () => {
        this.gpsMsg.set('No se pudo obtener la ubicación (permiso denegado).');
        this.capturandoGps.set(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // ── Guardar ──
  async guardar() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    if (!this.fotosCompletas()) {
      this.error.set('Faltan fotos obligatorias (las 6: frente, atrás, lados, tablero y combustible).');
      return;
    }
    if (this.saving()) return;

    this.saving.set(true);
    this.error.set('');
    const v = this.form.getRawValue();
    const id = this.vehiculosService.nuevaEntregaId();

    try {
      // Subir las fotos guiadas.
      const fotos: { slot: string; path: string }[] = [];
      for (const [slot, file] of Object.entries(this.slotFotos())) {
        fotos.push(await this.vehiculosService.uploadEntregaFoto(id, slot, file));
      }

      // Subir daños (con su foto opcional).
      const danos: { zona: string; descripcion: string | null; foto_path: string | null }[] = [];
      if (this.tieneDanos()) {
        for (const d of this.danos()) {
          if (!d.zona.trim()) continue;
          let fotoPath: string | null = null;
          if (d.file) {
            const up = await this.vehiculosService.uploadEntregaFoto(id, 'dano', d.file);
            fotoPath = up.path;
          }
          danos.push({ zona: d.zona.trim(), descripcion: d.descripcion.trim() || null, foto_path: fotoPath });
        }
      }

      // Firma opcional.
      let firmaUrl: string | null = null;
      const pad = this.firmaPad();
      if (pad && !pad.isEmpty()) {
        const blob = await pad.toBlob();
        if (blob) firmaUrl = await this.vehiculosService.uploadEntregaFirma(id, blob);
      }

      // Guardamos lo subido por si hay que reintentar con handover (sin re-subir).
      this.pendingId = id;
      this.pendingFotos = fotos;
      this.pendingDanos = danos;
      this.pendingFirma = firmaUrl;

      const payload = {
        id,
        vehiculoId: v.vehiculo_id!,
        tipo: v.tipo!,
        km: Number(v.km),
        combustible: v.combustible!,
        tieneDanos: this.tieneDanos() && danos.length > 0,
        danos,
        firmaUrl,
        fotos,
        gps: this.gps(),
        observacion: v.observacion?.trim() || null,
      };
      await this.enviarEntrega(payload, false);
    } catch (e: unknown) {
      this.manejarError(e);
    } finally {
      this.saving.set(false);
    }
  }

  /** Llama al RPC; propaga HandoverRequeridoError para que lo maneje el caller. */
  private async enviarEntrega(
    payload: Parameters<VehiculosService['crearEntrega']>[0],
    forzarHandover: boolean,
  ) {
    await this.vehiculosService.crearEntrega({ ...payload, forzarHandover });
    this.handoverPendiente = null;
    this.handoverInfo.set(null);
    this.toast.success(
      payload.tipo === 'recepcion' ? 'Recepción registrada' : 'Devolución registrada',
      forzarHandover
        ? 'Se cerró la entrega anterior y quedó a tu nombre.'
        : 'La responsabilidad del vehículo quedó registrada con su evidencia.',
    );
    this.creada.emit();
  }

  private manejarError(e: unknown) {
    if (e instanceof HandoverRequeridoError) {
      // W3 — el vehículo está entregado a otro conductor. Guardamos el payload
      // (fotos ya subidas) para reintentar con handover si el usuario confirma.
      this.handoverInfo.set(e.info);
      const v = this.form.getRawValue();
      this.handoverPendiente = {
        id: this.pendingId!,
        vehiculoId: v.vehiculo_id!,
        tipo: v.tipo!,
        km: Number(v.km),
        combustible: v.combustible!,
        tieneDanos: this.tieneDanos() && this.pendingDanos.length > 0,
        danos: this.pendingDanos,
        firmaUrl: this.pendingFirma,
        fotos: this.pendingFotos,
        gps: this.gps(),
        observacion: v.observacion?.trim() || null,
      };
      this.error.set('');
      return;
    }
    this.error.set(e instanceof Error ? e.message : 'No se pudo registrar la entrega.');
  }

  /** W3 — confirmar el handover (solo roles elevados). Reintenta sin re-subir. */
  async confirmarHandover() {
    if (!this.handoverPendiente || !this.esFlotaElevado || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.enviarEntrega(this.handoverPendiente, true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo completar el handover.');
    } finally {
      this.saving.set(false);
    }
  }

  cancelarHandover() {
    this.handoverPendiente = null;
    this.handoverInfo.set(null);
  }

  // Buffers para reintentar el handover sin volver a subir archivos.
  private pendingId: string | null = null;
  private pendingFotos: { slot: string; path: string }[] = [];
  private pendingDanos: { zona: string; descripcion: string | null; foto_path: string | null }[] = [];
  private pendingFirma: string | null = null;
}
