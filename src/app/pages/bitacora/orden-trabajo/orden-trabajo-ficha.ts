import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { OrdenTrabajoDetalle, OrdenTrabajoFirma } from '../../../../shared/models/bitacora.model';

/**
 * BN1 — Ficha de una orden de trabajo: detalle + las dos firmas (ingeniero y
 * cliente) con un botón de impresión (ventana autocontenida → PDF, patrón carnet).
 * Cumple AT11: la data enviada (firmas, monto, descripción) se puede ver aquí.
 */
@Component({
  selector: 'app-orden-trabajo-ficha',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './orden-trabajo-ficha.html',
  styleUrl: './orden-trabajo-ficha.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdenTrabajoFicha implements OnInit {
  private route = inject(ActivatedRoute);
  private bitacoraService = inject(BitacoraService);

  loading = signal(true);
  error = signal('');
  orden = signal<OrdenTrabajoDetalle | null>(null);
  /** URL firmada por rol para pintar las firmas. */
  firmaUrls = signal<Record<string, string>>({});

  firmaIng = computed(() => this.orden()?.firmas.find((fi) => fi.rol === 'ingeniero') ?? null);
  firmaCli = computed(() => this.orden()?.firmas.find((fi) => fi.rol === 'cliente') ?? null);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.error.set('Orden no encontrada.'); this.loading.set(false); return; }
    try {
      const data = await this.bitacoraService.getOrdenTrabajo(id);
      if (!data || !data.bitacora) { this.error.set('No se encontró la orden o no tienes acceso.'); return; }
      this.orden.set(data);
      // Resolver las firmas a URLs firmadas para mostrarlas.
      const urls: Record<string, string> = {};
      for (const fi of data.firmas) {
        try { urls[fi.rol] = await this.bitacoraService.getSignedUrl(fi.firma_path); } catch { /* firma opcional */ }
      }
      this.firmaUrls.set(urls);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la orden de trabajo.');
    } finally {
      this.loading.set(false);
    }
  }

  private async toDataUrl(url: string): Promise<string> {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((r) => {
        const fr = new FileReader();
        fr.onloadend = () => r(typeof fr.result === 'string' ? fr.result : '');
        fr.readAsDataURL(blob);
      });
    } catch { return ''; }
  }

  private firmaBox(f: OrdenTrabajoFirma | null, img: string, titulo: string): string {
    return `<div class="firma">
      <div class="firma-img">${img ? `<img src="${img}" alt="Firma">` : ''}</div>
      <div class="firma-line"></div>
      <div class="firma-nom">${f?.nombre ?? '—'}</div>
      <div class="firma-rol">${titulo}${f?.rol_desc ? ' · ' + f.rol_desc : ''}</div>
      ${f?.cedula ? `<div class="firma-ced">Cédula: ${f.cedula}</div>` : ''}
    </div>`;
  }

  /** Abre una ventana imprimible autocontenida (→ guardar como PDF) con las dos firmas. */
  async imprimir() {
    const o = this.orden();
    if (!o || !o.bitacora) return;
    const urls = this.firmaUrls();
    const [imgIng, imgCli] = await Promise.all([
      urls['ingeniero'] ? this.toDataUrl(urls['ingeniero']) : Promise.resolve(''),
      urls['cliente'] ? this.toDataUrl(urls['cliente']) : Promise.resolve(''),
    ]);
    const b = o.bitacora; const d = o.detalle;
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (!win) return;
    const fila = (label: string, val: string | null | undefined) =>
      val ? `<tr><td class="lbl">${label}</td><td>${val}</td></tr>` : '';
    const monto = d?.monto_estimado != null ? 'RD$ ' + Number(d.monto_estimado).toLocaleString('es-DO') : null;
    const cant = d?.cantidad != null ? `${d.cantidad}${d.unidad ? ' ' + d.unidad : ''}` : null;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Orden de trabajo</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 28px; }
        h1 { font-size: 18px; margin-bottom: 2px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        td { padding: 6px 8px; font-size: 13px; vertical-align: top; border-bottom: 1px solid #eee; }
        td.lbl { color: #777; width: 180px; }
        .desc { white-space: pre-wrap; }
        .firmas { display: flex; gap: 40px; margin-top: 48px; }
        .firma { flex: 1; text-align: center; }
        .firma-img { height: 70px; display: flex; align-items: flex-end; justify-content: center; }
        .firma-img img { max-height: 70px; max-width: 100%; }
        .firma-line { border-top: 1px solid #333; margin: 4px 0 6px; }
        .firma-nom { font-weight: 700; font-size: 13px; }
        .firma-rol { font-size: 11px; color: #666; }
        .firma-ced { font-size: 11px; color: #666; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>CONSTRUCTORA SD — Orden de trabajo</h1>
      <div class="sub">Obra: ${b.proyecto ?? '—'} · Fecha: ${b.fecha ?? '—'}</div>
      <table>
        ${fila('Descripción del trabajo', d?.descripcion ? `<span class="desc">${d.descripcion}</span>` : '—')}
        ${fila('Ubicación en la obra', d?.ubicacion)}
        ${fila('Cantidad', cant)}
        ${fila('Monto estimado', monto)}
        ${fila('Solicitado por (cliente)', d?.solicitado_por)}
        ${fila('Comentarios', b.comentarios)}
        ${fila('Registrado por', b.autor)}
      </table>
      <div class="firmas">
        ${this.firmaBox(this.firmaIng(), imgIng, 'Ingeniero')}
        ${this.firmaBox(this.firmaCli(), imgCli, 'Cliente')}
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
      </body></html>`);
    win.document.close();
  }
}
