import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../../shared/services/toast.service';

interface DetalleLinea {
  etiqueta: string;
  valor: string;
}
interface Borrador {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  resumen: string | null;
  estado: 'pendiente' | 'confirmado' | 'descartado' | 'caducado';
  creado_en: string;
  expira_en: string;
  resultado: { ok: boolean; mensaje: string } | null;
}

// Ruta de "editar antes de crear" por tipo — abre el formulario normal del SGC
// (sin pre-llenado automático todavía: follow-up documentado en PARIDAD.md).
const RUTA_POR_TIPO: Record<string, string> = {
  tarea: '/tareas',
  requisicion: '/inventario/requisiciones',
  conduce: '/inventario/conduces',
  ruta: '/flota',
};
const TITULO_POR_TOOL: Record<string, string> = {
  proponer_tarea: 'Borrador de tarea',
  proponer_requisicion: 'Borrador de requisición',
  proponer_conduce: 'Borrador de conduce',
  proponer_ruta: 'Borrador de ruta de transporte',
};

@Component({
  selector: 'app-borrador-claude',
  imports: [ButtonDirective, TranslatePipe, RouterLink],
  templateUrl: './borrador-claude.html',
  styleUrl: './borrador-claude.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BorradorClaude implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  cargando = signal(true);
  error = signal<string | null>(null);
  borrador = signal<Borrador | null>(null);
  detalle = signal<DetalleLinea[]>([]);
  enviando = signal(false);
  resultado = signal<{ ok: boolean; mensaje: string } | null>(null);

  titulo = () => TITULO_POR_TOOL[this.borrador()?.tool ?? ''] ?? 'Borrador';
  rutaVolver = () => RUTA_POR_TIPO[this.tipoDeTool()] ?? '/dashboard';

  private tipoDeTool(): string {
    const t = this.borrador()?.tool ?? '';
    return t.replace('proponer_', '');
  }

  async ngOnInit() {
    await this.cargar();
  }

  private async invoke(accion: string) {
    const id = this.route.snapshot.paramMap.get('id');
    const { data, error } = await this.supabase.client.functions.invoke('claude-borrador', {
      body: { accion, id },
    });
    if (error) throw error;
    return data;
  }

  async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const data = await this.invoke('get');
      this.borrador.set(data.borrador);
      this.detalle.set(data.detalle ?? []);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el borrador.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Texto legible ("23 h" / "45 min") en vez de minutos crudos. */
  tiempoRestante(): string {
    const b = this.borrador();
    if (!b) return '';
    const min = Math.max(0, Math.round((new Date(b.expira_en).getTime() - Date.now()) / 60000));
    return min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;
  }

  items(): { nombre: string; cantidad: unknown }[] {
    const items = (this.borrador()?.params as { items?: { articulo_id: string; cantidad: unknown }[] })?.items;
    return Array.isArray(items) ? items.map((i) => ({ nombre: i.articulo_id, cantidad: i.cantidad })) : [];
  }

  async confirmar() {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      const data = await this.invoke('confirmar');
      this.resultado.set({ ok: !!data.ok, mensaje: data.mensaje ?? '' });
      if (data.ok) {
        await this.cargar();
        this.toast.success(data.duplicado ? 'Ya estaba confirmado.' : 'Creado correctamente.');
      } else {
        this.toast.error(data.mensaje ?? 'No se pudo completar.');
      }
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo confirmar el borrador');
    } finally {
      this.enviando.set(false);
    }
  }

  async descartar() {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.invoke('descartar');
      await this.cargar();
      this.toast.success('Borrador descartado.');
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo descartar el borrador');
    } finally {
      this.enviando.set(false);
    }
  }

  async editarAntesDeCrear() {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.invoke('descartar');
    } catch {
      /* best-effort: igual navegamos al formulario normal */
    } finally {
      this.enviando.set(false);
    }
    this.router.navigateByUrl(this.rutaVolver());
  }
}
