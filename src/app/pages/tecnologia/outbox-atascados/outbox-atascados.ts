import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

/**
 * BG2 — "Outbox atascado": registros que la app móvil no pudo enviar por errores
 * de SISTEMA (RLS/constraint/5xx) — data real de obra que se quedó en el teléfono.
 * Antes Xaviel se enteraba por un screenshot de un ingeniero DOS SEMANAS después;
 * ahora Tecnología recibe alerta + ve aquí el conteo y el detalle (tipo, usuario,
 * error, edad, intentos, fotos en riesgo). Gate: es_tecnologia.
 */
interface OutboxItem {
  id: string;
  tipo_op: string;
  categoria: 'sistema' | 'dato' | 'transitorio';
  error_kind: string | null;
  error_code: string | null;
  error_msg: string | null;
  intentos: number;
  fotos_count: number;
  edad_horas: number | null;
  payload_resumen: Record<string, unknown> | null;
  usuario_nombre: string | null;
  roles_snapshot: string | null;
  primera_vez: string;
  ultima_vez: string;
  resuelto: boolean;
}
interface Conteos {
  total: number;
  pendientes: number;
  sistema: number;
  dato: number;
  transitorio: number;
  usuarios_afectados: number;
  fotos_en_riesgo: number;
  mas_viejo_horas: number;
  ultimos_7d: number;
}

const TIPO_LABEL: Record<string, string> = {
  bitacora: 'Bitácora',
  echada: 'Echada de combustible',
  confirmacion: 'Confirmación',
  conduce: 'Conduce',
  conduce_externo: 'Conduce externo',
  ficha_personal: 'Ficha de personal',
};

// CC7 — etiquetas legibles para el payload (nada de uuid crudo salvo en "Detalle técnico").
const PAYLOAD_LABEL: Record<string, string> = {
  salida_id: 'Conduce (ID)',
  bodega_id: 'Almacén (ID)',
  articulo_id: 'Artículo (ID)',
  proyecto_id: 'Obra (ID)',
  cantidad: 'Cantidad',
  fecha: 'Fecha',
  client_uuid: 'ID de envío',
};

interface ConduceRenglon { articulo: string | null; enviado: number | null; recibido: number | null; unidad: string | null; }
interface ConduceDetalle {
  id: string; codigo: string; fecha: string | null; estado: string | null;
  origen: string | null; destino: string | null; chofer: string | null;
  vehiculo: string | null; receptor: string | null; proyecto: string | null;
  firma_path: string | null; foto_entrega: string | null; foto_recepcion: string | null; foto_carga: string | null;
  anulado: boolean; renglones: ConduceRenglon[];
}
interface OutboxDetalle {
  atascado: OutboxItem & {
    usuario_id: string | null;
    reintento_solicitado_en: string | null;
    evidencia_solicitada_en: string | null;
  };
  payload: Record<string, unknown> | null;
  evidencia: { paths: string[]; subido_en: string }[];
  conduce?: ConduceDetalle;
}

@Component({
  selector: 'app-tec-outbox-atascados',
  imports: [DatePipe, JsonPipe],
  templateUrl: './outbox-atascados.html',
  styleUrl: './outbox-atascados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOutboxAtascados implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  filas = signal<OutboxItem[]>([]);
  conteos = signal<Conteos | null>(null);
  loading = signal(true);
  error = signal('');

  filtroCategoria = signal<'todas' | 'sistema' | 'dato' | 'transitorio'>('todas');
  soloPendientes = signal(true);

  filasVisibles = computed(() => {
    const c = this.filtroCategoria();
    const p = this.soloPendientes();
    return this.filas().filter(
      (f) => (c === 'todas' || f.categoria === c) && (!p || !f.resuelto),
    );
  });

  tipoLabel(t: string): string {
    return TIPO_LABEL[t] ?? t.replace(/_/g, ' ');
  }
  categoriaLabel(c: string): string {
    return c === 'sistema'
      ? 'Error del sistema'
      : c === 'dato'
        ? 'Error de dato'
        : c === 'transitorio'
          ? 'Transitorio'
          : c;
  }
  resumenTexto(r: Record<string, unknown> | null): string {
    if (!r) return '';
    return Object.entries(r)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [{ data: conteos }, { data: filas, error: e2 }] = await Promise.all([
        this.supabase.client.rpc('outbox_atascados_conteos'),
        this.supabase.client.rpc('outbox_atascados_listado', {
          p_categoria: null,
          p_solo_pendientes: false,
          p_limite: 500,
        }),
      ]);
      if (e2) throw e2;
      this.conteos.set((conteos as Conteos) ?? null);
      this.filas.set((filas as OutboxItem[]) ?? []);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }

  setCategoria(c: 'todas' | 'sistema' | 'dato' | 'transitorio') {
    this.filtroCategoria.set(c);
  }
  togglePendientes() {
    this.soloPendientes.update((v) => !v);
  }

  // ── CC7 — Ficha del atascado: conduce completo + payload legible + foto ──────
  detalleOpen = signal(false);
  detalle = signal<OutboxDetalle | null>(null);
  detalleLoading = signal(false);
  detalleError = signal('');
  fotoUrls = signal<string[]>([]);
  pidiendo = signal(false);

  /** Pares legibles del payload (uuid → etiqueta; el JSON crudo va en Detalle técnico). */
  payloadPares = computed(() => {
    const p = this.detalle()?.payload;
    if (!p) return [] as { k: string; v: string }[];
    return Object.entries(p).map(([k, v]) => ({ k: PAYLOAD_LABEL[k] ?? k.replace(/_/g, ' '), v: String(v) }));
  });

  async abrirDetalle(f: OutboxItem) {
    this.detalleOpen.set(true);
    this.detalleLoading.set(true);
    this.detalleError.set('');
    this.detalle.set(null);
    this.fotoUrls.set([]);
    try {
      const { data, error } = await this.supabase.client.rpc('outbox_atascado_detalle', { p_id: f.id });
      if (error) throw error;
      const det = data as OutboxDetalle;
      this.detalle.set(det);
      // Fotos de la evidencia (bucket privado) → URLs firmadas.
      const paths = (det.evidencia ?? []).flatMap((e) => e.paths ?? []);
      if (paths.length) {
        const urls: string[] = [];
        for (const path of paths) {
          const { data: signed } = await this.supabase.client.storage
            .from('outbox-atascados').createSignedUrl(path, 3600);
          if (signed?.signedUrl) urls.push(signed.signedUrl);
        }
        this.fotoUrls.set(urls);
      }
    } catch (e) {
      this.detalleError.set(e instanceof Error ? e.message : 'No se pudo cargar el detalle.');
    } finally {
      this.detalleLoading.set(false);
    }
  }

  cerrarDetalle() {
    this.detalleOpen.set(false);
    this.detalle.set(null);
    this.fotoUrls.set([]);
  }

  /** Minutos transcurridos desde un ISO (para "hace N min"). */
  minutosDesde(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 60000));
  }

  async pedirReintento() {
    const det = this.detalle();
    if (!det || this.pidiendo()) return;
    this.pidiendo.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('outbox_atascado_pedir_reintento', { p_id: det.atascado.id });
      if (error) throw error;
      const r = data as { usuario_id: string | null; salida_id: string | null; tipo_op: string | null };
      if (r?.usuario_id) {
        await this.supabase.client.functions.invoke('send-push', {
          body: {
            user_ids: [r.usuario_id], titulo: 'Reintentar envío',
            cuerpo: 'Tecnología pidió reintentar un envío atascado.', tipo: 'outbox_reintentar',
            data: { type: 'outbox_reintentar', atascado_id: det.atascado.id, salida_id: r.salida_id },
          },
        }).catch(() => { /* best-effort */ });
      }
      // Refleja el sello sin recargar todo.
      this.detalle.update((d) => d ? { ...d, atascado: { ...d.atascado, reintento_solicitado_en: new Date().toISOString() } } : d);
      this.toast.success('Reintento solicitado al teléfono');
    } catch (e) {
      this.toast.error('No se pudo solicitar el reintento', e instanceof Error ? e.message : undefined);
    } finally {
      this.pidiendo.set(false);
    }
  }

  async pedirEvidencia() {
    const det = this.detalle();
    if (!det || this.pidiendo()) return;
    this.pidiendo.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('outbox_atascado_pedir_evidencia', { p_id: det.atascado.id });
      if (error) throw error;
      const r = data as { usuario_id: string | null; usuario_nombre: string | null; salida_id: string | null };
      if (r?.usuario_id) {
        await this.supabase.client.functions.invoke('send-push', {
          body: {
            user_ids: [r.usuario_id], titulo: 'Sube la evidencia',
            cuerpo: 'Tecnología necesita la foto/datos de un envío atascado.', tipo: 'outbox_subir_evidencia',
            data: { type: 'outbox_subir_evidencia', atascado_id: det.atascado.id, salida_id: r.salida_id },
          },
        }).catch(() => { /* best-effort */ });
      }
      this.detalle.update((d) => d ? { ...d, atascado: { ...d.atascado, evidencia_solicitada_en: new Date().toISOString() } } : d);
      this.toast.success('Le pedimos que suba la evidencia');
    } catch (e) {
      this.toast.error('No se pudo pedir la evidencia', e instanceof Error ? e.message : undefined);
    } finally {
      this.pidiendo.set(false);
    }
  }

  async resolver(f: OutboxItem, resuelto: boolean) {
    try {
      const { error } = await this.supabase.client.rpc('outbox_atascado_resolver', {
        p_id: f.id,
        p_resuelto: resuelto,
        p_nota: null,
      });
      if (error) throw error;
      this.filas.update((fs) => fs.map((x) => (x.id === f.id ? { ...x, resuelto } : x)));
      this.toast.success(resuelto ? 'Marcado como resuelto' : 'Reabierto');
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }
}
