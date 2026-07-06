import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LegalService } from '../../../../shared/services/legal.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ProveedoresService } from '../../../../shared/services/proveedores.service';
import { UserService } from '../../../core/services/user.service';
import { CONTRATO_ESTADOS, CONTRATO_TIPOS, Contrato, ContratoEstado } from '../../../../shared/models/legal.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { Proveedor } from '../../../../shared/models/proveedor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

const ESTADO_TRANSICIONES: Record<ContratoEstado, ContratoEstado[]> = {
  borrador: ['en_revision', 'cancelado'],
  en_revision: ['firmado', 'borrador', 'cancelado'],
  firmado: ['vencido', 'cancelado'],
  vencido: ['cancelado'],
  cancelado: [],
};

@Component({
  selector: 'app-contratos',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, DecimalPipe],
  templateUrl: './contratos.html',
  styleUrl: './contratos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Contratos implements OnInit {
  private legalService = inject(LegalService);
  private proyectosService = inject(ProyectosService);
  private proveedoresService = inject(ProveedoresService);
  private userService = inject(UserService);

  readonly TIPOS = CONTRATO_TIPOS;
  readonly ESTADOS = CONTRATO_ESTADOS;

  contratos = signal<Contrato[]>([]);
  proyectos = signal<Proyecto[]>([]);
  proveedores = signal<Proveedor[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  searchQuery = signal('');
  selectedEstado = signal<string>('all');

  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  detailOpen = signal(false);
  detailContrato = signal<Contrato | null>(null);

  form = new FormGroup({
    titulo: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo: new FormControl<string>('otro', [Validators.required]),
    contraparte_nombre: new FormControl('', [Validators.required]),
    proveedor_id: new FormControl<string | null>(null),
    proyecto_id: new FormControl<string | null>(null),
    monto: new FormControl<number | null>(null),
    fecha_inicio: new FormControl<string | null>(null),
    fecha_vencimiento: new FormControl<string | null>(null),
  });

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();

    return this.contratos().filter((c) => {
      if (
        q &&
        !c.titulo.toLowerCase().includes(q) &&
        !c.codigo.toLowerCase().includes(q) &&
        !c.contraparte_nombre.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (estado !== 'all' && c.estado !== estado) return false;
      return true;
    });
  });

  porVencerCount = computed(() => {
    const limite = new Date();
    limite.setDate(limite.getDate() + 30);
    return this.contratos().filter(
      (c) =>
        c.fecha_vencimiento &&
        ['firmado', 'en_revision'].includes(c.estado) &&
        new Date(c.fecha_vencimiento) <= limite,
    ).length;
  });

  drawerTitle = computed(() => (this.editingId() ? 'Editar contrato' : 'Nuevo contrato'));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [contratos, proyectos, proveedores] = await Promise.all([
        this.legalService.getContratos(),
        this.proyectosService.getAll(),
        this.proveedoresService.getAll(),
      ]);
      this.contratos.set(contratos);
      this.proyectos.set(proyectos);
      this.proveedores.set(proveedores);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los contratos.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }
  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }
  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('all');
  }

  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({ tipo: 'otro' });
    this.drawerOpen.set(true);
  }

  openEdit(c: Contrato) {
    this.editingId.set(c.id);
    this.saveError.set('');
    this.form.reset({
      titulo: c.titulo,
      tipo: c.tipo,
      contraparte_nombre: c.contraparte_nombre,
      proveedor_id: c.proveedor_id,
      proyecto_id: c.proyecto_id,
      monto: c.monto,
      fecha_inicio: c.fecha_inicio,
      fecha_vencimiento: c.fecha_vencimiento,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    const payload: Partial<Contrato> = {
      titulo: raw.titulo!,
      tipo: raw.tipo as Contrato['tipo'],
      contraparte_nombre: raw.contraparte_nombre!,
      proveedor_id: raw.proveedor_id || null,
      proyecto_id: raw.proyecto_id || null,
      monto: raw.monto ?? null,
      fecha_inicio: raw.fecha_inicio || null,
      fecha_vencimiento: raw.fecha_vencimiento || null,
    };

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.legalService.updateContrato(id, payload);
        this.contratos.update((list) => list.map((c) => (c.id === id ? updated : c)));
      } else {
        payload.creado_por = this.userService.profile()?.id ?? null;
        payload.responsable_id = this.userService.profile()?.id ?? null;
        const created = await this.legalService.createContrato(payload);
        this.contratos.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  openDetail(c: Contrato) {
    this.detailContrato.set(c);
    this.detailOpen.set(true);
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  async cambiarEstado(estado: ContratoEstado) {
    const c = this.detailContrato();
    if (!c) return;
    const updated = await this.legalService.cambiarEstadoContrato(c.id, estado);
    this.detailContrato.set(updated);
    this.contratos.update((list) => list.map((item) => (item.id === c.id ? updated : item)));
  }

  nextEstados(current: ContratoEstado): ContratoEstado[] {
    return ESTADO_TRANSICIONES[current];
  }

  // ── Helpers ──────────────────────────────────────────────
  estadoBadgeClass(estado: ContratoEstado): string {
    switch (estado) {
      case 'borrador': return 'sgc-badge sgc-badge--neutral';
      case 'en_revision': return 'sgc-badge sgc-badge--info';
      case 'firmado': return 'sgc-badge sgc-badge--success';
      case 'vencido': return 'sgc-badge sgc-badge--danger';
      case 'cancelado': return 'sgc-badge sgc-badge--neutral';
    }
  }

  estadoLabel(estado: ContratoEstado): string {
    return this.ESTADOS.find((e) => e.value === estado)?.label ?? estado;
  }

  tipoLabel(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  isPorVencer(c: Contrato): boolean {
    if (!c.fecha_vencimiento || !['firmado', 'en_revision'].includes(c.estado)) return false;
    const limite = new Date();
    limite.setDate(limite.getDate() + 30);
    return new Date(c.fecha_vencimiento) <= limite;
  }

  get f() {
    return this.form.controls;
  }
}
