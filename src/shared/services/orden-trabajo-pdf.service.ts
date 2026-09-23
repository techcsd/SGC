import { Injectable } from '@angular/core';
import { OrdenTrabajoDetalle, OrdenTrabajoFirma } from '../models/bitacora.model';

/**
 * BW1 — plantilla ÚNICA de impresión/PDF de la Orden de trabajo (AU1: el padre es
 * la fuente de verdad; la app la importa por copia padre→hijo). Genera una ventana
 * autocontenida imprimible → "Guardar como PDF" (patrón carnet). Extraída de la
 * ficha (OrdenTrabajoFicha.imprimir) para que la web y la app compartan un solo
 * layout. Cumple AT11: toda la data enviada (firmas, monto, descripción) se ve aquí.
 *
 * Nota: el "PDF como archivo" del Web Share (navigator.canShare({files})) requiere
 * generar un Blob (pdf-lib) — follow-up. Hoy: Imprimir/PDF por esta ventana +
 * Compartir por enlace.
 */
@Injectable({ providedIn: 'root' })
export class OrdenTrabajoPdfService {
  /** Número visible OT-000123 a partir del `numero` de la orden. */
  codigo(numero: number | null | undefined): string {
    return 'OT-' + String(numero ?? 0).padStart(6, '0');
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

  /**
   * Abre una ventana imprimible autocontenida (→ guardar como PDF) con el detalle
   * y las dos firmas. `firmaUrls` = URLs firmadas por rol (ingeniero/cliente).
   */
  async abrirImprimible(orden: OrdenTrabajoDetalle, firmaUrls: Record<string, string>): Promise<void> {
    const b = orden.bitacora;
    const d = orden.detalle;
    if (!b) return;
    const firmaIng = orden.firmas.find((fi) => fi.rol === 'ingeniero') ?? null;
    const firmaCli = orden.firmas.find((fi) => fi.rol === 'cliente') ?? null;
    const [imgIng, imgCli] = await Promise.all([
      firmaUrls['ingeniero'] ? this.toDataUrl(firmaUrls['ingeniero']) : Promise.resolve(''),
      firmaUrls['cliente'] ? this.toDataUrl(firmaUrls['cliente']) : Promise.resolve(''),
    ]);
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (!win) return;
    const fila = (label: string, val: string | null | undefined) =>
      val ? `<tr><td class="lbl">${label}</td><td>${val}</td></tr>` : '';
    const monto = d?.monto_estimado != null ? 'RD$ ' + Number(d.monto_estimado).toLocaleString('es-DO') : null;
    const cant = d?.cantidad != null ? `${d.cantidad}${d.unidad ? ' ' + d.unidad : ''}` : null;
    const cod = this.codigo(d?.numero);
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Orden de trabajo ${cod}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 28px; }
        h1 { font-size: 18px; margin-bottom: 2px; }
        .cod { font-size: 13px; color: #b26a00; font-weight: 700; margin-bottom: 2px; }
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
      <div class="cod">${cod}</div>
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
        ${this.firmaBox(firmaIng, imgIng, 'Ingeniero')}
        ${this.firmaBox(firmaCli, imgCli, 'Cliente')}
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
      </body></html>`);
    win.document.close();
  }
}
