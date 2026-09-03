import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  AdminService,
  DuplicadoCandidato,
  FusionPreviewFila,
  FusionResultado,
} from '../../../../shared/services/admin.service';
import { identidadLabel } from '../../../../shared/utils/identidad.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * BI6 / AU18 — Detección y fusión de personas duplicadas.
 * El índice único de BH4 no puede atrapar dos filas con cédulas DISTINTAS que son
 * la misma persona (caso Manolo / MANOLO DURAN). Esta herramienta las lista por
 * similitud, previsualiza qué actividad se re-apuntaría, y fusiona en un solo
 * usuario_id canónico. Gate server-side (admin/tecnología). Todo queda en auditoría.
 */
@Component({
  selector: 'app-admin-usuarios-duplicados',
  imports: [Skeleton, DecimalPipe],
  templateUrl: './usuarios-duplicados.html',
  styleUrl: './usuarios-duplicados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsuariosDuplicados implements OnInit {
  private admin = inject(AdminService);
  identidad = identidadLabel;

  candidatos = signal<DuplicadoCandidato[]>([]);
  loading = signal(true);
  error = signal('');

  // Fila expandida (preview) + selección de canónico.
  expandKey = signal<string | null>(null);
  preview = signal<FusionPreviewFila[]>([]);
  previewLoading = signal(false);
  canonicoId = signal<string | null>(null);
  fusionando = signal(false);
  resultado = signal<FusionResultado | null>(null);
  fusionError = signal('');

  async ngOnInit() {
    await this.recargar();
  }

  async recargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.candidatos.set(await this.admin.detectarDuplicados(0.45));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron detectar duplicados.');
    } finally {
      this.loading.set(false);
    }
  }

  keyDe(c: DuplicadoCandidato): string {
    return `${c.id_a}|${c.id_b}`;
  }

  async toggle(c: DuplicadoCandidato) {
    const k = this.keyDe(c);
    if (this.expandKey() === k) {
      this.expandKey.set(null);
      return;
    }
    this.expandKey.set(k);
    this.resultado.set(null);
    this.fusionError.set('');
    // Por defecto, el canónico es el que tiene MÁS actividad (o el activo). Se
    // decide tras el preview del que se propone como duplicado.
    this.canonicoId.set(c.activo_a ? c.id_a : c.id_b);
    await this.cargarPreview(c);
  }

  /** Previsualiza la actividad de AMBOS lados para que el humano elija canónico. */
  async cargarPreview(c: DuplicadoCandidato) {
    this.previewLoading.set(true);
    this.preview.set([]);
    try {
      const otro = this.canonicoId() === c.id_a ? c.id_b : c.id_a;
      this.preview.set(await this.admin.previsualizarFusion(otro));
    } catch (e: unknown) {
      this.fusionError.set(e instanceof Error ? e.message : 'No se pudo previsualizar.');
    } finally {
      this.previewLoading.set(false);
    }
  }

  async elegirCanonico(c: DuplicadoCandidato, id: string) {
    this.canonicoId.set(id);
    this.resultado.set(null);
    await this.cargarPreview(c);
  }

  totalFilas(): number {
    return this.preview().reduce((s, f) => s + Number(f.filas), 0);
  }

  async fusionar(c: DuplicadoCandidato) {
    const canonico = this.canonicoId();
    if (!canonico) return;
    const duplicado = canonico === c.id_a ? c.id_b : c.id_a;
    const nombreCanon = canonico === c.id_a ? c.nombre_a : c.nombre_b;
    const nombreDup = canonico === c.id_a ? c.nombre_b : c.nombre_a;
    if (!confirm(
      `¿Fusionar "${nombreDup}" dentro de "${nombreCanon}"?\n\n` +
      `Se re-apunta la actividad de ${nombreDup} (${this.totalFilas()} registros) a ${nombreCanon}, ` +
      `y ${nombreDup} queda inactivo. Lo que choque se deja para revisión manual (no se borra nada). ` +
      `Queda en la auditoría.`,
    )) return;
    this.fusionando.set(true);
    this.fusionError.set('');
    try {
      const res = await this.admin.fusionarUsuarios(canonico, duplicado);
      this.resultado.set(res);
      await this.recargar(); // el par desaparece de la lista
    } catch (e: unknown) {
      this.fusionError.set(e instanceof Error ? e.message : 'No se pudo fusionar.');
    } finally {
      this.fusionando.set(false);
    }
  }
}
