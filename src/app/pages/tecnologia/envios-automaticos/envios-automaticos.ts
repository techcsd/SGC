import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { EnviosAutomaticosService, EnvioAutomatico } from '../../../../shared/services/envios-automaticos.service';
import { RolesService, Rol } from '../../../../shared/services/roles.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/** DB10/DB11 — config del bloque «Quién recibe» por familia de correo. El
 *  parámetro de ROLES ya existía (param_csv con default); el de PERSONAS EXTRA
 *  nace en db5 (correos sueltos, con o sin usuario — Sócrates, Eduardo, Yonairis). */
interface DestinatariosCfg {
  rolesParam: string;
  rolesDefault: string;
  extrasParam: string;
}
const DESTINATARIOS_CFG: Record<string, DestinatariosCfg> = {
  resumen_operaciones: {
    rolesParam: 'resumen_operaciones_roles',
    rolesDefault: 'admin,direccion,gerencia,logistica,jefe_flota',
    extrasParam: 'resumen_operaciones_correos_extra',
  },
  rendimiento_vehiculos: {
    rolesParam: 'rendimiento_vehiculos_roles',
    rolesDefault: 'direccion,jefe_flota,logistica',
    extrasParam: 'rendimiento_vehiculos_correos_extra',
  },
};

/**
 * CT10 — panel "Envíos automáticos": interruptor por familia de reporte/aviso
 * que mandan los crons (Resumen semanal de operaciones, Incentivo semanal,
 * Avisos de reporte semanal, Cronograma). Antes no existía ninguno — lo único
 * posible era desprogramar el cron a mano en la base.
 */
@Component({
  selector: 'app-tec-envios-automaticos',
  templateUrl: './envios-automaticos.html',
  styleUrl: './envios-automaticos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class TecEnviosAutomaticos implements OnInit {
  private service = inject(EnviosAutomaticosService);
  private toast = inject(ToastService);

  readonly esProd = environment.entorno === 'prod';
  readonly formatTs = formatTimestampDisplay;

  loading = signal(true);
  error = signal('');
  envios = signal<EnvioAutomatico[]>([]);
  busyFamilia = signal<string | null>(null);
  probandoFamilia = signal<string | null>(null);

  /** CU3 — solo las familias que son correo a una lista tienen un "yo" al que
   * mandarles una prueba; las de aviso in-app/webhook no tienen ese análogo. */
  readonly FAMILIAS_CON_PRUEBA = new Set(['resumen_operaciones', 'incentivo_semanal', 'rendimiento_vehiculos']);

  // Modal de motivo (solo cuando hace falta: apagar en prod).
  motivoOpen = signal(false);
  motivoFamilia = signal<EnvioAutomatico | null>(null);
  motivoTexto = signal('');

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.envios.set(await this.service.listar());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar los envíos automáticos.');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(e: EnvioAutomatico) {
    // Apagar en prod exige motivo (el servidor lo valida igual; se pide aquí para no ir y volver).
    if (this.esProd && e.activo) {
      this.motivoFamilia.set(e);
      this.motivoTexto.set('');
      this.motivoOpen.set(true);
      return;
    }
    void this.aplicar(e.familia, !e.activo, null);
  }

  async confirmarMotivo() {
    const e = this.motivoFamilia();
    if (!e) return;
    if (!this.motivoTexto().trim()) {
      this.toast.error('Falta el motivo', 'Apagar un envío automático en producción exige un motivo.');
      return;
    }
    await this.aplicar(e.familia, false, this.motivoTexto().trim());
    this.motivoOpen.set(false);
  }

  private async aplicar(familia: string, activo: boolean, motivo: string | null) {
    this.busyFamilia.set(familia);
    try {
      await this.service.set(familia, activo, motivo);
      this.toast.success(activo ? 'Encendido' : 'Apagado', `«${this.nombreDe(familia)}» queda ${activo ? 'activo' : 'apagado'}.`);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo cambiar', e instanceof Error ? e.message : undefined);
    } finally {
      this.busyFamilia.set(null);
    }
  }

  private nombreDe(familia: string): string {
    return this.envios().find((e) => e.familia === familia)?.nombre ?? familia;
  }

  async probar(e: EnvioAutomatico) {
    this.probandoFamilia.set(e.familia);
    try {
      const correo = await this.service.probar(e.familia);
      this.toast.success('Prueba enviada', `Revisa ${correo} — llegará aunque «${e.nombre}» esté apagado.`);
    } catch (err: unknown) {
      this.toast.error('No se pudo mandar la prueba', err instanceof Error ? err.message : undefined);
    } finally {
      this.probandoFamilia.set(null);
    }
  }

  // ── DB10/DB11 — «Quién recibe» por familia ──────────────────────────────────
  private rolesService = inject(RolesService);

  readonly CFG = DESTINATARIOS_CFG;
  tieneDestinatarios(familia: string): boolean { return familia in DESTINATARIOS_CFG; }

  quienRecibeOpen = signal<string | null>(null);
  roles = signal<Rol[]>([]);
  /** valores vivos de los parámetros (clave → CSV). */
  private params = signal<Record<string, string>>({});
  guardandoDest = signal(false);
  nuevoCorreo = signal('');
  preview = signal<{ email: string; nombre: string }[]>([]);

  rolesActivos(familia: string): Set<string> {
    const cfg = DESTINATARIOS_CFG[familia];
    const csv = this.params()[cfg.rolesParam] ?? cfg.rolesDefault;
    return new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
  }
  correosExtra(familia: string): string[] {
    const cfg = DESTINATARIOS_CFG[familia];
    return (this.params()[cfg.extrasParam] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  async toggleQuienRecibe(e: EnvioAutomatico) {
    if (this.quienRecibeOpen() === e.familia) { this.quienRecibeOpen.set(null); return; }
    this.quienRecibeOpen.set(e.familia);
    this.nuevoCorreo.set('');
    try {
      const claves = Object.values(DESTINATARIOS_CFG).flatMap((c) => [c.rolesParam, c.extrasParam]);
      const [params, roles] = await Promise.all([
        this.service.getParametros(claves),
        this.roles().length ? Promise.resolve(this.roles()) : this.rolesService.getAll(),
      ]);
      this.params.set(params);
      this.roles.set(roles);
      await this.cargarPreview(e.familia);
    } catch (err: unknown) {
      this.toast.error('No se pudo cargar «Quién recibe»', err instanceof Error ? err.message : undefined);
    }
  }

  private async cargarPreview(familia: string) {
    try {
      this.preview.set(await this.service.destinatarios(familia as 'resumen_operaciones' | 'rendimiento_vehiculos'));
    } catch { this.preview.set([]); }
  }

  previewResumen(): string {
    return this.preview().map((p) => (p.nombre && p.nombre !== p.email ? p.nombre : p.email)).join(', ');
  }

  async toggleRol(familia: string, codigo: string) {
    const cfg = DESTINATARIOS_CFG[familia];
    const set = this.rolesActivos(familia);
    if (set.has(codigo)) set.delete(codigo); else set.add(codigo);
    await this.guardarParam(familia, cfg.rolesParam, [...set].join(','),
      `Roles que reciben «${this.nombreDe(familia)}» (CSV)`);
  }

  async agregarCorreo(familia: string) {
    const correo = this.nuevoCorreo().trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      this.toast.error('Correo no válido', 'Escribe un correo completo, p. ej. yonairis@constructorasd.com');
      return;
    }
    const lista = this.correosExtra(familia);
    if (lista.includes(correo)) { this.nuevoCorreo.set(''); return; }
    const cfg = DESTINATARIOS_CFG[familia];
    await this.guardarParam(familia, cfg.extrasParam, [...lista, correo].join(','),
      `Personas extra (CSV de correos) que reciben «${this.nombreDe(familia)}»`);
    this.nuevoCorreo.set('');
  }

  async quitarCorreo(familia: string, correo: string) {
    const cfg = DESTINATARIOS_CFG[familia];
    const lista = this.correosExtra(familia).filter((c) => c !== correo);
    await this.guardarParam(familia, cfg.extrasParam, lista.join(','),
      `Personas extra (CSV de correos) que reciben «${this.nombreDe(familia)}»`);
  }

  private async guardarParam(familia: string, clave: string, valor: string, descripcion: string) {
    this.guardandoDest.set(true);
    try {
      await this.service.setParametro(clave, valor, descripcion);
      this.params.set({ ...this.params(), [clave]: valor });
      await this.cargarPreview(familia);
    } catch (err: unknown) {
      this.toast.error('No se pudo guardar', err instanceof Error ? err.message : undefined);
    } finally {
      this.guardandoDest.set(false);
    }
  }
}
