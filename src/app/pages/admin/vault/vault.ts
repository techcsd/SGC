import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { BovedaService } from '../../../../shared/services/boveda.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { BovedaEntrada, BovedaAcceso, BovedaTipo, BovedaEstadoRotacion } from '../../../../shared/models/boveda.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Icon } from '../../../../shared/ui/icon/icon';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import {
  generarPassword, generarPassphrase, generarLlaveApi, generarSemilla2fa, etiquetaFortaleza,
} from '../../../../shared/utils/boveda-generador.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

type FiltroTipo = 'all' | BovedaTipo;
type GeneradorModo = 'password' | 'passphrase' | 'api' | '2fa';

const TIPO_LABEL: Record<BovedaTipo, string> = {
  cuenta: 'Cuenta web', api: 'Llave API / token', '2fa': 'Código 2FA', nota: 'Nota segura', archivo: 'Archivo',
};

function estadoRotacion(e: BovedaEntrada): BovedaEstadoRotacion {
  if (!e.rotar_cada_dias) return 'sin_rotacion';
  const base = new Date(e.ultima_rotacion ?? e.created_at).getTime();
  const vence = base + e.rotar_cada_dias * 86_400_000;
  const diasRestantes = Math.ceil((vence - Date.now()) / 86_400_000);
  if (diasRestantes < 0) return 'vencida';
  if (diasRestantes <= 7) return 'por_rotar';
  return 'al_dia';
}

@Component({
  selector: 'app-admin-vault',
  imports: [ReactiveFormsModule, FormDrawer, Icon, FileUpload, TranslatePipe],
  templateUrl: './vault.html',
  styleUrl: './vault.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminVault implements OnInit, OnDestroy {
  private boveda = inject(BovedaService);
  private toast = inject(ToastService);

  formatTimestamp = formatTimestampDisplay;
  TIPO_LABEL = TIPO_LABEL;
  estadoRotacion = estadoRotacion;

  // ── Candado / sesión ───────────────────────────────────────────────────
  desbloqueado = signal(false);
  desbloqueando = signal(false);
  passwordForm = new FormGroup({ password: new FormControl<string>('', { nonNullable: true }) });
  errorDesbloqueo = signal('');
  sesionExpiraEn = signal<number | null>(null); // segundos restantes
  private contadorId: ReturnType<typeof setInterval> | null = null;

  entradas = signal<BovedaEntrada[]>([]);
  loading = signal(true);
  query = signal('');
  filtroTipo = signal<FiltroTipo>('all');
  soloPorRotar = signal(false);

  entradasFiltradas = computed(() => {
    const q = this.query().trim().toLowerCase();
    const t = this.filtroTipo();
    const porRotar = this.soloPorRotar();
    return this.entradas().filter((e) => {
      if (t !== 'all' && e.tipo !== t) return false;
      if (porRotar && !['por_rotar', 'vencida'].includes(estadoRotacion(e))) return false;
      if (!q) return true;
      return e.nombre.toLowerCase().includes(q) || (e.sitio_url ?? '').toLowerCase().includes(q) || (e.usuario_texto ?? '').toLowerCase().includes(q);
    });
  });
  conteo(t: FiltroTipo): number {
    if (t === 'all') return this.entradas().length;
    return this.entradas().filter((e) => e.tipo === t).length;
  }

  // ── Crear/editar ──────────────────────────────────────────────────────
  drawerOpen = signal(false);
  editandoId = signal<string | null>(null);
  guardando = signal(false);
  form = new FormGroup({
    tipo: new FormControl<BovedaTipo>('cuenta', { nonNullable: true }),
    nombre: new FormControl<string>('', { nonNullable: true }),
    sitio_url: new FormControl<string | null>(null),
    usuario_texto: new FormControl<string | null>(null),
    valor: new FormControl<string>('', { nonNullable: true }),
    etiquetasTexto: new FormControl<string>('', { nonNullable: true }),
    rotar_cada_dias: new FormControl<number | null>(null),
    notas: new FormControl<string | null>(null),
  });
  archivoPendiente = signal<File | null>(null);

  // ── Generador (CZ9) ─────────────────────────────────────────────────────
  generadorAbierto = signal(false);
  generadorModo = signal<GeneradorModo>('password');
  generadorLargo = signal(20);
  generadorResultado = signal<{ valor: string; bitsEntropia: number } | null>(null);
  etiquetaFortaleza = etiquetaFortaleza;

  // ── Detalle ──────────────────────────────────────────────────────────────
  detailOpen = signal(false);
  detalle = signal<BovedaEntrada | null>(null);
  valorRevelado = signal<string | null>(null);
  segundosVisible = signal(0);
  codigo2fa = signal<string | null>(null);
  segundos2fa = signal(0);
  private timerOcultar: ReturnType<typeof setInterval> | null = null;
  private timer2fa: ReturnType<typeof setInterval> | null = null;

  // ── Registro de accesos ─────────────────────────────────────────────────
  accesosOpen = signal(false);
  accesos = signal<BovedaAcceso[]>([]);

  async ngOnInit() {
    const vigente = await this.boveda.sesionVigenteHasta();
    if (vigente) {
      this.desbloqueado.set(true);
      this.iniciarContadorSesion(vigente);
      await this.cargar();
    } else {
      this.loading.set(false);
    }
  }
  ngOnDestroy() {
    this.limpiarTimers();
  }
  private limpiarTimers() {
    if (this.contadorId) clearInterval(this.contadorId);
    if (this.timerOcultar) clearInterval(this.timerOcultar);
    if (this.timer2fa) clearInterval(this.timer2fa);
  }
  private iniciarContadorSesion(hasta: Date) {
    if (this.contadorId) clearInterval(this.contadorId);
    const tick = () => {
      const restante = Math.max(0, Math.round((hasta.getTime() - Date.now()) / 1000));
      this.sesionExpiraEn.set(restante);
      if (restante <= 0) {
        this.desbloqueado.set(false);
        this.detailOpen.set(false);
        if (this.contadorId) clearInterval(this.contadorId);
      }
    };
    tick();
    this.contadorId = setInterval(tick, 1000);
  }

  async desbloquear() {
    const password = this.passwordForm.getRawValue().password;
    if (!password) return;
    this.desbloqueando.set(true);
    this.errorDesbloqueo.set('');
    try {
      const { expira_at } = await this.boveda.abrirSesion(password);
      this.passwordForm.reset({ password: '' });
      this.desbloqueado.set(true);
      this.iniciarContadorSesion(new Date(expira_at));
      await this.cargar();
    } catch (e: unknown) {
      this.errorDesbloqueo.set(e instanceof Error ? e.message : 'No se pudo entrar.');
    } finally {
      this.desbloqueando.set(false);
    }
  }

  private async cargar() {
    this.loading.set(true);
    try {
      this.entradas.set(await this.boveda.listar());
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo cargar el Vault');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Crear/editar ──────────────────────────────────────────────────────
  abrirCrear() {
    this.editandoId.set(null);
    this.form.reset({ tipo: 'cuenta', nombre: '', sitio_url: null, usuario_texto: null, valor: '', etiquetasTexto: '', rotar_cada_dias: null, notas: null });
    this.archivoPendiente.set(null);
    this.generadorResultado.set(null);
    this.drawerOpen.set(true);
  }
  abrirEditar(e: BovedaEntrada) {
    this.editandoId.set(e.id);
    this.form.reset({
      tipo: e.tipo, nombre: e.nombre, sitio_url: e.sitio_url, usuario_texto: e.usuario_texto,
      valor: '', etiquetasTexto: (e.etiquetas ?? []).join(', '), rotar_cada_dias: e.rotar_cada_dias, notas: e.notas,
    });
    this.archivoPendiente.set(null);
    this.generadorResultado.set(null);
    this.drawerOpen.set(true);
  }
  cerrarDrawer() {
    this.drawerOpen.set(false);
  }

  async onArchivoAdd(files: File[]) {
    this.archivoPendiente.set(files[0] ?? null);
  }

  async guardar() {
    const v = this.form.getRawValue();
    if (!v.nombre.trim()) { this.toast.error('El nombre es obligatorio'); return; }
    this.guardando.set(true);
    try {
      const etiquetas = v.etiquetasTexto.split(',').map((s) => s.trim()).filter(Boolean);
      if (v.tipo === 'archivo' && this.archivoPendiente() && !this.editandoId()) {
        const file = this.archivoPendiente()!;
        const base64 = await fileToBase64(file);
        await this.boveda.subirArchivo({ nombre: v.nombre, archivo_nombre: file.name, mime: file.type, contenido_base64: base64, etiquetas, notas: v.notas });
      } else if (this.editandoId()) {
        await this.boveda.editar(this.editandoId()!, {
          nombre: v.nombre, sitio_url: v.sitio_url, usuario_texto: v.usuario_texto,
          valor: v.valor || undefined, etiquetas, rotar_cada_dias: v.rotar_cada_dias, notas: v.notas,
        });
      } else {
        await this.boveda.crear({
          tipo: v.tipo, nombre: v.nombre, sitio_url: v.sitio_url, usuario_texto: v.usuario_texto,
          valor: v.valor || null, etiquetas, rotar_cada_dias: v.rotar_cada_dias, notas: v.notas,
        });
      }
      this.toast.success('Guardado');
      this.drawerOpen.set(false);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Generador ────────────────────────────────────────────────────────────
  abrirGenerador() {
    this.generadorAbierto.set(true);
    this.regenerar();
  }
  cerrarGenerador() {
    this.generadorAbierto.set(false);
  }
  regenerar() {
    const modo = this.generadorModo();
    if (modo === 'password') this.generadorResultado.set(generarPassword({ largo: this.generadorLargo() }));
    else if (modo === 'passphrase') this.generadorResultado.set(generarPassphrase());
    else if (modo === 'api') this.generadorResultado.set(generarLlaveApi('hex'));
    else this.generadorResultado.set(generarSemilla2fa());
  }
  usarGenerado() {
    const r = this.generadorResultado();
    if (!r) return;
    this.form.patchValue({ valor: r.valor });
    this.generadorAbierto.set(false);
  }

  // ── Detalle / revelar ──────────────────────────────────────────────────
  async abrirDetalle(e: BovedaEntrada) {
    this.detalle.set(e);
    this.valorRevelado.set(null);
    this.codigo2fa.set(null);
    this.detailOpen.set(true);
  }
  cerrarDetalle() {
    this.detailOpen.set(false);
    this.valorRevelado.set(null);
    this.codigo2fa.set(null);
    if (this.timerOcultar) clearInterval(this.timerOcultar);
    if (this.timer2fa) clearInterval(this.timer2fa);
  }

  async revelar() {
    const e = this.detalle();
    if (!e) return;
    try {
      const { valor, visible_segundos } = await this.boveda.revelar(e.id);
      this.mostrarTemporal(valor, visible_segundos);
    } catch (err: unknown) {
      this.toast.errorFrom(err, 'No se pudo revelar');
    }
  }
  async mostrarSemilla() {
    const e = this.detalle();
    if (!e) return;
    try {
      const { valor, visible_segundos } = await this.boveda.mostrarSemilla(e.id);
      this.mostrarTemporal(valor, visible_segundos);
    } catch (err: unknown) {
      this.toast.errorFrom(err, 'No se pudo mostrar la semilla');
    }
  }
  private mostrarTemporal(valor: string, segundos: number) {
    this.valorRevelado.set(valor);
    this.segundosVisible.set(segundos);
    if (this.timerOcultar) clearInterval(this.timerOcultar);
    this.timerOcultar = setInterval(() => {
      const n = this.segundosVisible() - 1;
      this.segundosVisible.set(n);
      if (n <= 0) {
        this.valorRevelado.set(null);
        if (this.timerOcultar) clearInterval(this.timerOcultar);
      }
    }, 1000);
  }

  async pedirCodigo2fa() {
    const e = this.detalle();
    if (!e) return;
    try {
      const { codigo, segundos_restantes } = await this.boveda.codigo2fa(e.id);
      this.codigo2fa.set(codigo);
      this.segundos2fa.set(segundos_restantes);
      if (this.timer2fa) clearInterval(this.timer2fa);
      this.timer2fa = setInterval(() => {
        const n = this.segundos2fa() - 1;
        if (n <= 0) void this.pedirCodigo2fa();
        else this.segundos2fa.set(n);
      }, 1000);
    } catch (err: unknown) {
      this.toast.errorFrom(err, 'No se pudo calcular el código');
    }
  }

  async copiar(valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      const e = this.detalle();
      if (e) await this.boveda.registrarCopia(e.id);
      this.toast.success('Copiado — se borra del portapapeles en 30 s');
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => undefined);
      }, 30_000);
    } catch {
      this.toast.error('No se pudo copiar');
    }
  }

  async descargarArchivo() {
    const e = this.detalle();
    if (!e) return;
    try {
      const { contenido_base64, archivo_nombre } = await this.boveda.descargarArchivo(e.id);
      const bytes = Uint8Array.from(atob(contenido_base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = archivo_nombre || e.archivo_nombre || 'archivo';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      this.toast.errorFrom(err, 'No se pudo descargar');
    }
  }

  async eliminar(e: BovedaEntrada) {
    try {
      await this.boveda.eliminar(e.id);
      this.detailOpen.set(false);
      await this.cargar();
      this.toast.success('Eliminado');
    } catch (err: unknown) {
      this.toast.errorFrom(err, 'No se pudo eliminar');
    }
  }

  // ── Registro de accesos ─────────────────────────────────────────────────
  async abrirAccesos() {
    this.accesosOpen.set(true);
    try {
      this.accesos.set(await this.boveda.listarAccesos());
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo cargar el registro');
    }
  }
  cerrarAccesos() {
    this.accesosOpen.set(false);
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
