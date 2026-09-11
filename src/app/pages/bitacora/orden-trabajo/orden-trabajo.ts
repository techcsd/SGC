import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UnidadesService } from '../../../../shared/services/unidades.service';
import { Unidad } from '../../../../shared/models/unidad.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { todayIso } from '../../../../shared/utils/fecha.util';

/**
 * BN1 — Alta de una orden de trabajo (bitácora tipo `orden_trabajo`): trabajo
 * pedido por el cliente, con descripción/ubicación/monto estimado y DOS firmas
 * capturadas en el mismo dispositivo (ingeniero + cliente). El monto es sólo
 * registro/exportable (§G-2: no hay facturación). Las dos firmas son obligatorias
 * (el servidor también lo valida en crear_orden_trabajo).
 */
@Component({
  selector: 'app-orden-trabajo',
  imports: [ReactiveFormsModule, RouterLink, SignaturePad],
  templateUrl: './orden-trabajo.html',
  styleUrl: './orden-trabajo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdenTrabajo implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private proyectosService = inject(ProyectosService);
  private datosPruebaView = inject(DatosPruebaViewService);
  private unidadesService = inject(UnidadesService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly today = todayIso();
  esAdmin = computed(() => this.userService.hasRole('admin'));

  firmaIng = viewChild<SignaturePad>('firmaIng');
  firmaCli = viewChild<SignaturePad>('firmaCli');

  proyectos = signal<Proyecto[]>([]);
  unidades = signal<Unidad[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');

  // AT14/AT26 — datos de prueba fuera de los selectores de obra para no-admin.
  proyectosVisibles = computed(() => this.datosPruebaView.visibles(this.proyectos()));

  form = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    fecha: new FormControl<string>(this.today, [Validators.required]),
    descripcion: new FormControl<string>('', [Validators.required, Validators.maxLength(1000)]),
    ubicacion: new FormControl<string | null>(null),
    cantidad: new FormControl<number | null>(null),
    unidad: new FormControl<string | null>(null),
    monto_estimado: new FormControl<number | null>(null),
    solicitado_por: new FormControl<string | null>(null),
    comentarios: new FormControl<string | null>(null),
    // Firma del ingeniero (autor). Nombre precargado con el usuario actual.
    ing_nombre: new FormControl<string>(this.userService.profile()?.nombre ?? '', [Validators.required]),
    ing_cedula: new FormControl<string | null>(null),
    ing_rol_desc: new FormControl<string | null>('Ingeniero'),
    // Firma del cliente (texto libre; puede no tener cuenta).
    cli_nombre: new FormControl<string>('', [Validators.required]),
    cli_cedula: new FormControl<string | null>(null),
    cli_rol_desc: new FormControl<string | null>('Cliente'),
    es_prueba: new FormControl<boolean>(false),
  });

  get f() { return this.form.controls; }

  async ngOnInit() {
    try {
      const [proyectos, unidades] = await Promise.all([
        this.proyectosService.getAll(),
        this.unidadesService.getAll().catch(() => [] as Unidad[]),
      ]);
      this.proyectos.set(proyectos.filter((p) => p.activo));
      this.unidades.set(unidades);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las obras.');
    } finally {
      this.loading.set(false);
    }
  }

  limpiarFirma(rol: 'ing' | 'cli') {
    (rol === 'ing' ? this.firmaIng() : this.firmaCli())?.clear();
  }

  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const padIng = this.firmaIng();
    const padCli = this.firmaCli();
    // Las dos firmas son obligatorias salvo admin (registro retroactivo).
    if (!this.esAdmin()) {
      if (!padIng || padIng.isEmpty()) { this.error.set('Falta la firma del ingeniero.'); return; }
      if (!padCli || padCli.isEmpty()) { this.error.set('Falta la firma del cliente.'); return; }
    }

    this.saving.set(true);
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      // Subir las firmas presentes (PNG) al bucket privado sgc-bitacora.
      let firmaIngPayload = null;
      let firmaCliPayload = null;
      if (padIng && !padIng.isEmpty()) {
        const blob = await padIng.toBlob();
        if (blob) {
          const path = await this.bitacoraService.subirFirmaOrden('ingeniero', blob);
          firmaIngPayload = { nombre: v.ing_nombre ?? 'Ingeniero', cedula: v.ing_cedula, rol_desc: v.ing_rol_desc, firma_path: path, metodo: 'pad' };
        }
      }
      if (padCli && !padCli.isEmpty()) {
        const blob = await padCli.toBlob();
        if (blob) {
          const path = await this.bitacoraService.subirFirmaOrden('cliente', blob);
          firmaCliPayload = { nombre: v.cli_nombre ?? 'Cliente', cedula: v.cli_cedula, rol_desc: v.cli_rol_desc, firma_path: path, metodo: 'pad' };
        }
      }

      const id = await this.bitacoraService.crearOrdenTrabajo({
        proyecto_id: v.proyecto_id!,
        fecha: v.fecha!,
        descripcion: v.descripcion!,
        ubicacion: v.ubicacion,
        cantidad: v.cantidad,
        unidad: v.unidad,
        monto_estimado: v.monto_estimado,
        solicitado_por: v.solicitado_por,
        comentarios: v.comentarios,
        firma_ing: firmaIngPayload,
        firma_cli: firmaCliPayload,
        es_prueba: this.esAdmin() ? (v.es_prueba ?? false) : false,
      });

      this.toast.success('Orden de trabajo registrada.', 'Con las dos firmas capturadas.');
      this.router.navigate(['/bitacora/orden-trabajo', id]);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo registrar la orden de trabajo.');
    } finally {
      this.saving.set(false);
    }
  }
}
