import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

interface DemoObra { id: string; codigo: string; nombre: string; }
interface DemoAlmacen { id: string; nombre: string; proyecto_id: string | null; }
interface DemoArticulo { id: string; codigo: string; nombre: string; unidad: string; }
interface DemoVehiculo { id: string; placa: string; marca: string; modelo: string; tipo: string; }
interface DemoChofer { id: string; nombre: string; }

interface DemoCatalogo {
  obras: DemoObra[];
  almacenes: DemoAlmacen[];
  articulos: DemoArticulo[];
  vehiculos: DemoVehiculo[];
  choferes: DemoChofer[];
}

const CATALOGO_VACIO: DemoCatalogo = { obras: [], almacenes: [], articulos: [], vehiculos: [], choferes: [] };

/**
 * F6 (DG5) — "Escenarios" (módulo Demo): vista de SOLO LECTURA de los datos de
 * demostración reales que ya existen en la base (OBRA DEMO y sus artículos, vehículos y
 * choferes DEMO-*), para que el usuario sepa qué hay disponible para practicar. Lee la RPC
 * `sgc.demo_catalogo()` (SECURITY DEFINER, filtra `es_prueba=true` explícitamente — ver
 * sql/2026-11-02-dg5-mas-datos-demo.sql), así que es segura para cualquier autenticado sin
 * depender de la RLS de cada tabla base. NO toca revisor_tiendas / es_usuario_demo().
 */
@Component({
  selector: 'app-demo-escenarios',
  imports: [RouterLink, TranslatePipe, StaggerDirective],
  templateUrl: './demo-escenarios.html',
  styleUrl: './demo-escenarios.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoEscenarios implements OnInit {
  private supabase = inject(SupabaseService);

  cargando = signal(true);
  error = signal('');
  catalogo = signal<DemoCatalogo>(CATALOGO_VACIO);

  async ngOnInit() {
    try {
      const { data, error } = await this.supabase.client.rpc('demo_catalogo');
      if (error) throw new Error(error.message);
      this.catalogo.set({ ...CATALOGO_VACIO, ...(data as Partial<DemoCatalogo>) });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar los escenarios de demostración.');
    } finally {
      this.cargando.set(false);
    }
  }

  nombreObra(proyectoId: string | null): string {
    if (!proyectoId) return '—';
    return this.catalogo().obras.find((o) => o.id === proyectoId)?.nombre ?? '—';
  }
}
