import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NotifMatrizService, NotifParam } from '../../../../shared/services/notif-matriz.service';
import { RolesService, Rol } from '../../../../shared/services/roles.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

interface ParamRow extends NotifParam {
  seleccion: Set<string>; // códigos de rol marcados
}

/** AT23 — Matriz de notificaciones: el admin ajusta QUIÉN recibe cada evento con
 *  matriz (por rol), sin tocar código. Backend: notif_config / set_notif_param. */
@Component({
  selector: 'app-admin-matriz-notificaciones',
  imports: [Skeleton],
  templateUrl: './matriz-notificaciones.html',
  styleUrl: './matriz-notificaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminMatrizNotificaciones implements OnInit {
  private svc = inject(NotifMatrizService);
  private rolesSvc = inject(RolesService);
  private toast = inject(ToastService);

  params = signal<ParamRow[]>([]);
  roles = signal<Rol[]>([]);
  loading = signal(true);
  guardando = signal<string | null>(null);
  error = signal('');

  // Referencia (solo lectura) de eventos → a quién le llega, para contexto.
  readonly eventos = [
    { evento: 'Conduce por confirmar', quien: 'Responsables de la obra + roles de obra ligados + roles globales (editable abajo)' },
    { evento: 'Requisición creada', quien: 'Módulo Inventario + gerente de producción/proyectos + jefe de ingenieros' },
    { evento: 'Requisición aprobada/rechazada', quien: 'El solicitante' },
    { evento: 'Material no catalogado', quien: 'Módulo Inventario + admin' },
    { evento: 'Echada / consumo anómalo', quien: 'Módulo Flota + admin' },
    { evento: 'Incentivo aprobado/declinado', quien: 'El chofer (en “Mi rendimiento”)' },
    { evento: 'Informe de incentivo (lunes)', quien: 'Roles con el módulo Incentivos (Logística, Gerencia, Admin)' },
  ];

  async ngOnInit() {
    try {
      const [params, roles] = await Promise.all([this.svc.config(), this.rolesSvc.getAll()]);
      this.roles.set(roles);
      this.params.set(
        params.map((p) => ({
          ...p,
          seleccion: new Set(p.valor.split(',').map((s) => s.trim()).filter(Boolean)),
        })),
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la matriz.');
    } finally {
      this.loading.set(false);
    }
  }

  tiene(p: ParamRow, codigo: string): boolean {
    return p.seleccion.has(codigo);
  }

  toggle(clave: string, codigo: string) {
    this.params.update((list) =>
      list.map((p) => {
        if (p.clave !== clave) return p;
        const sel = new Set(p.seleccion);
        if (sel.has(codigo)) sel.delete(codigo);
        else sel.add(codigo);
        return { ...p, seleccion: sel };
      }),
    );
  }

  async guardar(p: ParamRow) {
    if (this.guardando()) return;
    this.guardando.set(p.clave);
    try {
      // Preserva el orden del catálogo de roles.
      const csv = this.roles()
        .map((r) => r.codigo)
        .filter((c) => p.seleccion.has(c))
        .join(',');
      await this.svc.setParam(p.clave, csv);
      this.params.update((list) => list.map((x) => (x.clave === p.clave ? { ...x, valor: csv } : x)));
      this.toast.success('Guardado', p.etiqueta);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(null);
    }
  }
}
