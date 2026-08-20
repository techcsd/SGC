import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InventarioAlmacenService, InventarioAlmacenItem } from '../../../../shared/services/inventario-almacen.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

interface FilaAjuste {
  articulo_id: string | null;
  codigo: string;
  nombre: string;
  actual: number;
  real: number;
  estado: 'ok' | 'warning';
  motivo: string;
}

function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

@Component({
  selector: 'app-ajuste-real',
  imports: [RouterLink],
  templateUrl: './ajuste-real.html',
  styleUrl: './ajuste-real.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AjusteReal implements OnInit {
  private inv = inject(InventarioAlmacenService);
  private bodegasSvc = inject(BodegasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  esAdmin = computed(() => this.userService.hasRole('admin'));
  bodegas = signal<Bodega[]>([]);
  selBodega = signal<string | null>(null);
  private inventario = signal<InventarioAlmacenItem[]>([]);
  filas = signal<FilaAjuste[]>([]);
  archivoNombre = signal('');
  paso = signal<'inicio' | 'preview' | 'hecho'>('inicio');
  procesando = signal(false);
  error = signal('');
  resultado = signal<{ ok: number; errores: { fila: number; msg: string }[] } | null>(null);

  okCount = computed(() => this.filas().filter((f) => f.estado === 'ok').length);
  sinMatch = computed(() => this.filas().filter((f) => f.estado === 'warning').length);
  conCambio = computed(() => this.filas().filter((f) => f.estado === 'ok' && f.real !== f.actual).length);

  async ngOnInit() {
    try {
      this.bodegas.set((await this.bodegasSvc.getAll()).filter((b) => b.activo));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar los almacenes.');
    }
  }

  async onBodega(id: string) {
    this.selBodega.set(id || null);
    this.filas.set([]);
    this.paso.set('inicio');
    if (!id) return;
    try {
      this.inventario.set(await this.inv.getInventario(id, true, null, true));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el inventario del almacén.');
    }
  }

  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.selBodega()) { this.toast.warning('Elige el almacén primero'); return; }
    this.error.set('');
    this.archivoNombre.set(file.name);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: null });
      this.parsear(rows);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  }

  private parsear(rows: unknown[][]) {
    // Header = fila que tenga una columna de cantidad y una de código o nombre.
    let hi = -1;
    for (let i = 0; i < rows.length; i++) {
      const h = rows[i].map(norm);
      const hasCant = h.some((c) => c.includes('CANTIDAD') || c.includes('REAL') || c.includes('STOCK') || c.includes('EXISTENC'));
      const hasId = h.some((c) => c.includes('CODIGO') || c.includes('CÓDIGO') || c.includes('NOMBRE') || c.includes('ARTICULO') || c.includes('DESCRIP'));
      if (hasCant && hasId) { hi = i; break; }
    }
    if (hi < 0) { this.error.set('No se encontró la fila de encabezados (necesita una columna de código/nombre y una de cantidad).'); return; }
    const h = rows[hi].map(norm);
    const col = (preds: ((c: string) => boolean)) => h.findIndex(preds);
    const iCod = col((c) => c.includes('CODIGO') || c.includes('CÓDIGO') || c === 'ART' || c.includes('ARTICULO'));
    const iNom = col((c) => c.includes('NOMBRE') || c.includes('DESCRIP'));
    const iCant = col((c) => c.includes('CANTIDAD') || c.includes('REAL') || c.includes('STOCK') || c.includes('EXISTENC'));

    const byCod = new Map(this.inventario().filter((a) => a.codigo).map((a) => [norm(a.codigo), a] as const));
    const byNom = new Map(this.inventario().map((a) => [norm(a.nombre), a] as const));

    const filas: FilaAjuste[] = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const cod = iCod >= 0 ? String(r[iCod] ?? '').trim() : '';
      const nom = iNom >= 0 ? String(r[iNom] ?? '').trim() : '';
      if (!cod && !nom) continue;
      const cantRaw = r[iCant];
      const cant = Number(String(cantRaw ?? '').replace(/[^0-9.-]/g, ''));
      const match = (cod && byCod.get(norm(cod))) || (nom && byNom.get(norm(nom))) || null;
      let estado: FilaAjuste['estado'] = 'ok';
      let motivo = '';
      if (!match) { estado = 'warning'; motivo = 'No existe en el catálogo del almacén'; }
      else if (isNaN(cant) || cantRaw === null || cantRaw === '') { estado = 'warning'; motivo = 'Cantidad inválida'; }
      filas.push({
        articulo_id: match?.articulo_id ?? null,
        codigo: match?.codigo ?? cod ?? '—',
        nombre: match?.nombre ?? nom ?? '—',
        actual: match?.cantidad ?? 0,
        real: isNaN(cant) ? 0 : cant,
        estado,
        motivo,
      });
    }
    if (!filas.length) { this.error.set('No se encontraron filas.'); return; }
    this.filas.set(filas);
    this.paso.set('preview');
  }

  async aplicar() {
    const bodega = this.selBodega();
    const validas = this.filas().filter((f) => f.estado === 'ok' && f.articulo_id);
    if (!bodega || !validas.length) { this.toast.warning('Nada que ajustar'); return; }
    if (!confirm(`¿Fijar el stock real de ${validas.length} artículos en este almacén? No genera movimiento ni escalón en la gráfica.`)) return;
    this.procesando.set(true);
    try {
      const res = await this.inv.ajusteRealLote(bodega, validas.map((f) => ({ articulo_id: f.articulo_id!, cantidad: f.real })));
      this.resultado.set(res);
      this.paso.set('hecho');
      this.toast.success('Ajuste real aplicado', `${res.ok} artículos ajustados.`);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo aplicar el ajuste.');
    } finally {
      this.procesando.set(false);
    }
  }

  descargarSinMatch() {
    const sin = this.filas().filter((f) => f.estado === 'warning');
    if (!sin.length) return;
    exportarExcel('ajuste-real-sin-match', sin.map((f) => ({ Codigo: f.codigo, Nombre: f.nombre, Cantidad: f.real, Motivo: f.motivo })), 'Sin match');
  }

  reiniciar() {
    this.filas.set([]);
    this.resultado.set(null);
    this.paso.set('inicio');
    this.error.set('');
  }
}
