import { Component, ChangeDetectionStrategy, computed, inject, signal, viewChild, OnInit } from '@angular/core';
import { identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Location } from '@angular/common';
import { SalidasService, ConduceRutaInfo, ConduceItemLibre } from '../../../../shared/services/salidas.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { SupabaseService } from '../../../../app/core/services/supabase.service';
import {
  SalidaInventario,
  SalidaFirma,
  SALIDA_ESTADO_LABELS,
  MOTIVOS_SALIDA,
  conduceNumero,
} from '../../../../shared/models/salida.model';
import { UserService } from '../../../../app/core/services/user.service';
import { formatFechaDisplay, formatTimestampDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';

interface ItemCierre {
  detalle_id: string;
  nombre: string;
  cantidad: number;
  cantidad_recibida: number;
}

/** AC7 — firma canónica del conduce ya resuelta con su URL firmada para pintarla. */
type FirmaConUrl = SalidaFirma & { url: string | null };

@Component({
  selector: 'app-conduce',
  imports: [Skeleton, SignaturePad, RouterLink, Lightbox],
  templateUrl: './conduce.html',
  styleUrl: './conduce.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduce implements OnInit {
  readonly idVehiculo = identificacionVehiculo;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private salidasService = inject(SalidasService);
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);
  private userService = inject(UserService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  readonly hoy = todayIso();
  readonly numeroConduce: string;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;

  salida = signal<SalidaInventario | null>(null);
  // La columna Talla solo se muestra si algún renglón la tiene (EPP) — así el
  // conduce de materiales normales queda limpio.
  mostrarTalla = computed(() => (this.salida()?.detalle_salidas ?? []).some((d) => !!d.talla));
  loading = signal(true);
  error = signal('');
  // AE5 — ruta/parada en la que viaja este conduce (para mostrar "su ruta").
  rutaInfo = signal<ConduceRutaInfo | null>(null);
  // AF23 — fase del ciclo de vida del conduce (Transporte v2).
  fase = signal<string | null>(null);
  readonly FASE_META: Record<string, { label: string; badge: string }> = {
    emitido: { label: 'Emitido', badge: 'info' },
    en_transito: { label: 'En tránsito', badge: 'warning' },
    entregado: { label: 'Entregado', badge: 'success' },
    confirmado: { label: 'Confirmado', badge: 'success' },
    pendiente_firma: { label: 'Pendiente de firma', badge: 'warning' },
    pendiente_firma_despachante: { label: 'Pendiente de firma del despachante', badge: 'warning' },
  };
  faseMeta = computed(() => {
    const f = this.fase();
    return f ? (this.FASE_META[f] ?? { label: f, badge: 'neutral' }) : null;
  });
  // Delivery evidence (photo + receiver signature) captured by the mobile app.
  entregaFotoUrl = signal<string | null>(null);
  entregaFirmaUrl = signal<string | null>(null);
  // Evidence photo taken when the salida itself was captured in the field.
  salidaFotoUrl = signal<string | null>(null);
  // AC7 — firmas canónicas del conduce (emisor entrega / receptor recibe), con su URL firmada.
  firmaEmisor = signal<FirmaConUrl | null>(null);
  firmaReceptor = signal<FirmaConUrl | null>(null);
  // AS5 — foto de evidencia en grande (lightbox).
  fotoLightbox = signal<string | null>(null);
  // AU4 — items libres (material no catalogado) que viajan en este conduce.
  itemsLibres = signal<ConduceItemLibre[]>([]);

  // ── Cierre de conduce por el chofer (paridad app de campo) ──
  mostrarCierre = signal(false);
  itemsCierre = signal<ItemCierre[]>([]);
  // Emisor = quien entrega (chofer/almacén). Se prellena con el usuario actual.
  emisorNombre = signal('');
  emisorCedula = signal('');
  emisorRolDesc = signal('');
  // Receptor = quien recibe en obra (puede no estar registrado → nombre libre).
  receptor = signal('');
  receptorCedula = signal('');
  notasCierre = signal('');
  fotoCierreFile = signal<File | null>(null);
  fotoCierrePreview = signal<string | null>(null);
  guardandoCierre = signal(false);
  cierreError = signal('');
  private firmaEmisorPad = viewChild<SignaturePad>('firmaEmisorPad');
  private firmaPad = viewChild<SignaturePad>('firmaPad');

  puedeCerrar = computed(() => this.salida()?.estado === 'despachado');

  // AS3 — despachante ("Entregado por"). AS2 — pendiente de firma remota.
  despachanteNombre = computed(() => this.salida()?.despachante_nombre?.trim() || null);
  firmaDespachantePendiente = computed(
    () => !!this.salida()?.despachante_usuario_id && !this.firmaEmisor(),
  );
  // AV3 — atajo "Recordarle al despachante" (re-push manual de la firma pendiente).
  recordando = signal(false);

  // AQ10 — Eliminar (anular) conduce: solo mientras pendiente (despachado, sin
  // recibir) y solo el emisor o un admin (el servidor lo reimpone). El botón es
  // solo UX; anular_conduce valida server-side.
  puedeAnular = computed(() => {
    const s = this.salida();
    const p = this.userService.profile();
    if (!s || !p) return false;
    if (s.estado !== 'despachado' || s.recibido_por) return false;
    return this.userService.roles().includes('admin') || s.creado_por === p.id;
  });
  mostrarAnular = signal(false);
  motivoAnulacion = signal('');
  anulando = signal(false);
  anularError = signal('');

  // ── AY12 — paridad web: iniciar ruta + transferir conduce ─────────────────
  private vehiculosService = inject(VehiculosService);
  puedeGestionarTransporte = computed(
    () => this.userService.roles().includes('admin') || this.userService.hasModulo('flota') || this.userService.hasModulo('inventario'),
  );
  /** Iniciar ruta: cuando el conduce aún no tiene ruta y no está entregado. */
  puedeIniciarRuta = computed(() => {
    const s = this.salida();
    return !!s && this.puedeGestionarTransporte() && !s.ruta_id && s.estado !== 'entregado' && s.estado !== 'anulado';
  });
  /** Transferir: cuando hay portador asignado y no está entregado/anulado. */
  puedeTransferir = computed(() => {
    const s = this.salida();
    return !!s && this.puedeGestionarTransporte() && !!s.conductor_id && s.estado !== 'entregado' && s.estado !== 'anulado';
  });
  vehiculosPicker = signal<Vehiculo[]>([]);
  conductoresPicker = signal<{ id: string; nombre: string }[]>([]);
  iniciarRutaOpen = signal(false);
  transferirOpen = signal(false);
  selVehiculo = signal<string | null>(null);
  selConductor = signal<string | null>(null);
  transferirNotas = signal('');
  transporteBusy = signal(false);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.numeroConduce = conduceNumero(id);
  }

  motivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Salida no especificada.');
      this.loading.set(false);
      return;
    }
    try {
      const s = await this.salidasService.getById(id);
      this.salida.set(s);
      await this.loadEvidencia(s);
      // AU4 — items libres (no bloqueante).
      this.salidasService.getItemsLibres(id).then((il) => this.itemsLibres.set(il)).catch(() => {});
      // AE5 — traza de la ruta/parada (no bloqueante).
      try {
        this.rutaInfo.set(await this.salidasService.getRutaInfo(id));
      } catch {
        /* la traza de ruta es complementaria */
      }
      // AF23 — fase del ciclo de vida (no bloqueante).
      this.salidasService.getFase(id).then((f) => this.fase.set(f));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la salida.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resolve the private storage paths to time-limited signed URLs. Delivery
   *  evidence lives in the `conduces` bucket; the salida capture photo in
   *  `inventario`. */
  private async loadEvidencia(s: SalidaInventario) {
    const sign = async (bucket: string, path: string | null): Promise<string | null> => {
      if (!path) return null;
      const { data } = await this.supabase.client.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    };
    this.entregaFotoUrl.set(await sign('conduces', s.entrega_foto_path));
    this.entregaFirmaUrl.set(await sign('conduces', s.entrega_firma_path));
    this.salidaFotoUrl.set(await sign('inventario', s.foto_path));

    // AC7 — firmas canónicas (emisor/receptor) desde salida_firmas.
    this.firmaEmisor.set(null);
    this.firmaReceptor.set(null);
    try {
      const firmas = await this.salidasService.getFirmas(s.id);
      for (const f of firmas) {
        const withUrl: FirmaConUrl = { ...f, url: await sign('conduces', f.firma_path) };
        if (f.rol === 'emisor') this.firmaEmisor.set(withUrl);
        else this.firmaReceptor.set(withUrl);
      }
    } catch {
      // Conduces legacy sin salida_firmas: se cae al render de entrega_firma_path.
    }
  }

  // ── AQ10 — Eliminar (anular) conduce ──
  abrirAnular() {
    this.motivoAnulacion.set('');
    this.anularError.set('');
    this.mostrarAnular.set(true);
  }
  cerrarAnular() {
    if (this.anulando()) return;
    this.mostrarAnular.set(false);
  }
  async confirmarAnular() {
    const s = this.salida();
    if (!s) return;
    this.anulando.set(true);
    this.anularError.set('');
    try {
      await this.salidasService.anularConduce(s.id, this.motivoAnulacion().trim() || null);
      this.toast.success(`Conduce ${this.numeroConduce} eliminado.`, 'Se repuso su stock y se canceló la ruta vinculada.');
      this.mostrarAnular.set(false);
      this.router.navigate(['/inventario/conduces']);
    } catch (e: unknown) {
      this.anularError.set(e instanceof Error ? e.message : 'No se pudo eliminar el conduce.');
    } finally {
      this.anulando.set(false);
    }
  }

  // ── AY12 — Iniciar ruta / Transferir conduce (paridad web) ────────────────
  private async recargarSalida() {
    const s = this.salida();
    if (!s) return;
    const fresca = await this.salidasService.getById(s.id);
    this.salida.set(fresca);
    await this.loadEvidencia(fresca);
    this.salidasService.getFase(s.id).then((f) => this.fase.set(f)).catch(() => {});
    this.salidasService.getRutaInfo(s.id).then((r) => this.rutaInfo.set(r)).catch(() => {});
  }

  async abrirIniciarRuta() {
    this.selVehiculo.set(null);
    this.iniciarRutaOpen.set(true);
    if (this.vehiculosPicker().length === 0) {
      try {
        const vs = await this.vehiculosService.getAll();
        this.vehiculosPicker.set(vs.filter((v) => v.activo && v.estado !== 'baja'));
      } catch { /* opcional */ }
    }
  }

  async confirmarIniciarRuta() {
    const s = this.salida();
    if (!s || this.transporteBusy()) return;
    this.transporteBusy.set(true);
    try {
      await this.salidasService.iniciarRuta(s.id, this.selVehiculo());
      this.toast.success('Ruta iniciada', 'El conduce quedó en ruta.');
      this.iniciarRutaOpen.set(false);
      await this.recargarSalida();
    } catch (e: unknown) {
      this.toast.error('No se pudo iniciar la ruta', e instanceof Error ? e.message : undefined);
    } finally {
      this.transporteBusy.set(false);
    }
  }

  async abrirTransferir() {
    this.selConductor.set(null);
    this.transferirNotas.set('');
    this.transferirOpen.set(true);
    if (this.conductoresPicker().length === 0) {
      try {
        this.conductoresPicker.set(await this.salidasService.getConductoresPicker());
      } catch { /* opcional */ }
    }
  }

  async confirmarTransferir() {
    const s = this.salida();
    const cond = this.selConductor();
    if (!s || this.transporteBusy()) return;
    if (!cond) { this.toast.error('Elige un chofer', 'Selecciona a quién transferir el conduce.'); return; }
    this.transporteBusy.set(true);
    try {
      await this.salidasService.ofrecerTransferencia(s.id, cond, this.transferirNotas().trim() || null);
      this.toast.success('Transferencia ofrecida', 'El chofer receptor debe aceptarla en su dispositivo.');
      this.transferirOpen.set(false);
      await this.recargarSalida();
    } catch (e: unknown) {
      this.toast.error('No se pudo transferir', e instanceof Error ? e.message : undefined);
    } finally {
      this.transporteBusy.set(false);
    }
  }

  // ── Cierre de conduce ──
  abrirCierre() {
    const s = this.salida();
    if (!s) return;
    // Emisor = usuario actual (chofer/almacén) por defecto; editable.
    this.emisorNombre.set(this.userService.profile()?.nombre ?? '');
    this.emisorCedula.set('');
    this.emisorRolDesc.set('');
    this.receptor.set(s.responsable ?? '');
    this.receptorCedula.set('');
    this.notasCierre.set('');
    this.quitarFotoCierre();
    this.cierreError.set('');
    this.itemsCierre.set(
      (s.detalle_salidas ?? []).map((d) => ({
        detalle_id: d.id,
        nombre: d.articulo?.nombre ?? '—',
        cantidad: d.cantidad,
        cantidad_recibida: d.cantidad,
      })),
    );
    this.mostrarCierre.set(true);
  }

  cancelarCierre() {
    this.mostrarCierre.set(false);
  }

  /** AV3 — recuerda al despachante que firme (re-push manual). */
  async recordarDespachante() {
    const s = this.salida();
    if (!s || this.recordando()) return;
    this.recordando.set(true);
    try {
      const nombre = await this.salidasService.recordarDespachante(s.id);
      if (nombre === null) {
        // Ya firmó entre medio → recarga salida + firmas para desbloquear la entrega.
        this.toast.success('El despachante ya firmó', 'Ya puedes registrar la entrega.');
        const fresca = await this.salidasService.getById(s.id);
        this.salida.set(fresca);
        await this.loadEvidencia(fresca);
      } else {
        this.toast.info(`Se le recordó a ${nombre}`, 'Te avisaremos cuando firme el conduce.');
      }
    } catch (e) {
      this.toast.error('No se pudo enviar el recordatorio', e instanceof Error ? e.message : undefined);
    } finally {
      this.recordando.set(false);
    }
  }

  updateRecibida(i: number, valor: string) {
    const n = Number(valor);
    this.itemsCierre.update((list) =>
      list.map((it, idx) => (idx === i ? { ...it, cantidad_recibida: isNaN(n) ? 0 : n } : it)),
    );
  }

  async onFotoCierre(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const comprimida = await comprimirImagen(file);
    const prev = this.fotoCierrePreview();
    if (prev) URL.revokeObjectURL(prev);
    this.fotoCierreFile.set(comprimida);
    this.fotoCierrePreview.set(URL.createObjectURL(comprimida));
  }

  quitarFotoCierre() {
    const prev = this.fotoCierrePreview();
    if (prev) URL.revokeObjectURL(prev);
    this.fotoCierreFile.set(null);
    this.fotoCierrePreview.set(null);
  }

  async confirmarCierre() {
    const s = this.salida();
    if (!s || this.guardandoCierre()) return;
    // AV3 — belt-and-suspenders: no cerrar si falta la firma del despachante
    // (el server igual lo rechaza con DR456; esto evita el intento en vano).
    if (this.firmaDespachantePendiente()) {
      this.cierreError.set('Falta la firma del despachante. No puedes registrar la entrega hasta que firme el conduce desde su sesión.');
      return;
    }
    const emisor = this.emisorNombre().trim();
    const receptor = this.receptor().trim();
    const emisorPad = this.firmaEmisorPad();
    const receptorPad = this.firmaPad();
    if (!emisor) {
      this.cierreError.set('Indica quién entrega el material.');
      return;
    }
    if (!emisorPad || emisorPad.isEmpty()) {
      this.cierreError.set('Falta la firma de quien entrega.');
      return;
    }
    if (!receptor) {
      this.cierreError.set('Indica quién recibe el material.');
      return;
    }
    if (!receptorPad || receptorPad.isEmpty()) {
      this.cierreError.set('Falta la firma de quien recibe.');
      return;
    }
    this.guardandoCierre.set(true);
    this.cierreError.set('');
    try {
      // AC7 — firma del EMISOR (quien entrega): sube a `conduces` y registra en salida_firmas.
      const emisorBlob = await emisorPad.toBlob();
      if (emisorBlob) {
        const emisorPath = await this.salidasService.subirEvidenciaConduce(s.id, 'firma-emisor', emisorBlob, 'png');
        await this.salidasService.firmarConduce(s.id, 'emisor', emisor, emisorPath, {
          cedula: this.emisorCedula().trim() || null,
          rolDesc: this.emisorRolDesc().trim() || null,
          usuarioId: this.userService.profile()?.id ?? null,
        });
      }

      // AC7 — firma del RECEPTOR (quien recibe). Se reutiliza también como firma
      // legacy `entrega_firma_path` para compatibilidad con la vista existente.
      let firmaPath: string | null = null;
      const receptorBlob = await receptorPad.toBlob();
      if (receptorBlob) {
        firmaPath = await this.salidasService.subirEvidenciaConduce(s.id, 'firma-receptor', receptorBlob, 'png');
        await this.salidasService.firmarConduce(s.id, 'receptor', receptor, firmaPath, {
          cedula: this.receptorCedula().trim() || null,
        });
      }

      let fotoPath: string | null = null;
      const foto = this.fotoCierreFile();
      if (foto) fotoPath = await this.salidasService.subirEvidenciaConduce(s.id, 'foto', foto, 'jpg');

      const items = this.itemsCierre().map((it) => ({
        detalle_id: it.detalle_id,
        cantidad_recibida: it.cantidad_recibida,
      }));
      await this.salidasService.entregarConduce(
        s.id,
        items,
        receptor,
        firmaPath,
        fotoPath,
        this.notasCierre().trim() || null,
      );

      // Recargar la salida + evidencia para reflejar el cierre.
      const fresca = await this.salidasService.getById(s.id);
      this.salida.set(fresca);
      await this.loadEvidencia(fresca);
      this.mostrarCierre.set(false);
      this.toast.success('Conduce entregado', 'Se registró la entrega con su evidencia.');
    } catch (e: unknown) {
      this.cierreError.set(e instanceof Error ? e.message : 'No se pudo registrar la entrega.');
    } finally {
      this.guardandoCierre.set(false);
    }
  }

  imprimir() {
    window.print();
  }

  /** Go back to wherever the user came from (Salidas, the Conduces list, or the
   *  engineer's Entregas page). Falls back to the dashboard on a direct hit. */
  volver() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
