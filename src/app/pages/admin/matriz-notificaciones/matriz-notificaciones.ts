import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NotifMatrizService, NotifParam, NotifEntrega, NotifTipoCat, NotifTipoFull, NotifRegla } from '../../../../shared/services/notif-matriz.service';
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
  imports: [Skeleton, FormsModule],
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

  // ── BF4 — reglas per-tipo: el admin apaga un tipo de alerta (global) ─────
  mostrarReglas = signal(false);
  tipos = signal<NotifTipoFull[]>([]);
  reglasMap = signal<Map<string, boolean>>(new Map()); // tipo → habilitado global
  guardandoRegla = signal<string | null>(null);
  // BK1 — canales por tipo (in_app/push/email).
  canalesMap = signal<Map<string, Set<string>>>(new Map());
  readonly CANALES = [
    { key: 'in_app', label: 'Campana' },
    { key: 'push', label: 'Push' },
    { key: 'email', label: 'Correo' },
  ];
  tieneCanal(tipo: string, canal: string): boolean {
    return this.canalesMap().get(tipo)?.has(canal) ?? false;
  }
  async toggleCanal(t: NotifTipoFull, canal: string) {
    if (this.guardandoRegla()) return;
    const set = new Set(this.canalesMap().get(t.tipo) ?? []);
    if (set.has(canal)) set.delete(canal); else set.add(canal);
    this.guardandoRegla.set(t.tipo);
    try {
      await this.svc.setTipoCanales(t.tipo, [...set], true);
      this.canalesMap.update((m) => new Map(m).set(t.tipo, set));
    } catch (e) {
      this.toast.error('No se pudo guardar el canal', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoRegla.set(null);
    }
  }

  // ── BK1 — reglas específicas por rol y por usuario ───────────────────────
  reglasEspecificas = signal<NotifRegla[]>([]);
  usuarios = signal<{ id: string; nombre: string }[]>([]);
  // Formulario "agregar regla".
  nrTipo = signal('');
  nrAmbito = signal<'rol' | 'usuario'>('usuario');
  nrRol = signal('');
  nrUsuarioId = signal('');
  nrBusqueda = signal('');
  nrHabilitado = signal(false); // por defecto se AÑADE para apagar
  guardandoEspecifica = signal(false);

  usuariosFiltrados = computed(() => {
    const q = this.nrBusqueda().trim().toLowerCase();
    const list = this.usuarios();
    if (!q) return list.slice(0, 8);
    return list.filter((u) => u.nombre.toLowerCase().includes(q)).slice(0, 8);
  });

  private cargarMapasReglas(cat: NotifTipoFull[], reglas: NotifRegla[]) {
    const m = new Map<string, boolean>();
    const cm = new Map<string, Set<string>>();
    for (const t of cat) {
      m.set(t.tipo, true); // por defecto habilitado
      cm.set(t.tipo, new Set(t.canales ?? []));
    }
    for (const r of reglas) if (r.rol === null && r.usuario_id === null) m.set(r.tipo, r.habilitado);
    this.reglasMap.set(m);
    this.canalesMap.set(cm);
    this.reglasEspecificas.set(reglas.filter((r) => r.rol !== null || r.usuario_id !== null));
  }

  async toggleReglas() {
    const abrir = !this.mostrarReglas();
    this.mostrarReglas.set(abrir);
    if (!abrir) return;
    try {
      const [cat, reglas, usuarios] = await Promise.all([
        this.svc.tiposFull(), this.svc.reglas(), this.svc.usuariosDirectorio(),
      ]);
      this.tipos.set(cat);
      this.usuarios.set(usuarios);
      this.cargarMapasReglas(cat, reglas);
    } catch (e) {
      this.toast.error('No se pudieron cargar las reglas', e instanceof Error ? e.message : undefined);
    }
  }

  etiquetaTipo(tipo: string): string {
    return this.tipos().find((t) => t.tipo === tipo)?.etiqueta ?? tipo;
  }
  nombreRol(codigo: string): string {
    return this.roles().find((r) => r.codigo === codigo)?.nombre ?? codigo;
  }
  seleccionarUsuario(u: { id: string; nombre: string }) {
    this.nrUsuarioId.set(u.id);
    this.nrBusqueda.set(u.nombre);
  }

  async agregarReglaEspecifica() {
    if (this.guardandoEspecifica()) return;
    const tipo = this.nrTipo();
    if (!tipo) { this.toast.error('Elige un tipo de aviso'); return; }
    const esUsuario = this.nrAmbito() === 'usuario';
    const rol = esUsuario ? null : (this.nrRol() || null);
    const usuarioId = esUsuario ? (this.nrUsuarioId() || null) : null;
    if (esUsuario && !usuarioId) { this.toast.error('Elige un usuario'); return; }
    if (!esUsuario && !rol) { this.toast.error('Elige un rol'); return; }
    this.guardandoEspecifica.set(true);
    try {
      await this.svc.setRegla(tipo, rol, this.nrHabilitado(), usuarioId);
      const [cat, reglas] = await Promise.all([this.svc.tiposFull(), this.svc.reglas()]);
      this.tipos.set(cat);
      this.cargarMapasReglas(cat, reglas);
      // Reset del formulario.
      this.nrTipo.set(''); this.nrRol.set(''); this.nrUsuarioId.set(''); this.nrBusqueda.set('');
      this.toast.success('Regla guardada');
    } catch (e) {
      this.toast.error('No se pudo guardar la regla', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoEspecifica.set(false);
    }
  }

  async toggleReglaEspecifica(r: NotifRegla) {
    if (this.guardandoEspecifica()) return;
    this.guardandoEspecifica.set(true);
    try {
      await this.svc.setRegla(r.tipo, r.rol, !r.habilitado, r.usuario_id);
      const [cat, reglas] = await Promise.all([this.svc.tiposFull(), this.svc.reglas()]);
      this.tipos.set(cat);
      this.cargarMapasReglas(cat, reglas);
    } catch (e) {
      this.toast.error('No se pudo cambiar la regla', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoEspecifica.set(false);
    }
  }
  tipoHabilitado(tipo: string): boolean {
    return this.reglasMap().get(tipo) ?? true;
  }
  async toggleTipoGlobal(t: NotifTipoCat) {
    if (this.guardandoRegla()) return;
    const next = !this.tipoHabilitado(t.tipo);
    this.guardandoRegla.set(t.tipo);
    try {
      await this.svc.setRegla(t.tipo, null, next);
      this.reglasMap.update((m) => new Map(m).set(t.tipo, next));
      this.toast.success(next ? 'Aviso habilitado' : 'Aviso deshabilitado', t.etiqueta);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoRegla.set(null);
    }
  }

  // ── BF4 — traza de entregas (diagnóstico "no me llegó") ──────────────────
  mostrarEntregas = signal(false);
  entregas = signal<NotifEntrega[]>([]);
  cargandoEntregas = signal(false);

  async toggleEntregas() {
    const abrir = !this.mostrarEntregas();
    this.mostrarEntregas.set(abrir);
    if (abrir) await this.cargarEntregas();
  }
  async cargarEntregas() {
    this.cargandoEntregas.set(true);
    try {
      this.entregas.set(await this.svc.entregasRecientes(150));
    } catch (e) {
      this.toast.error('No se pudo cargar la traza de entregas', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoEntregas.set(false);
    }
  }
  estadoEntregaBadge(e: string): string {
    return e === 'enviada' || e === 'entregada' ? 'success' : e === 'fallida' ? 'danger' : 'neutral';
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
