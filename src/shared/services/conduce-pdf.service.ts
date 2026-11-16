import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SalidaInventario, SalidaFirma, conduceNumero } from '../models/salida.model';
import { PdfBloque, construirPdf } from '../utils/pdf-simple.util';

/** Arma los bloques del documento (puro; sin red). Exportado para pruebas. */
export function bloquesConduce(s: SalidaInventario, firmas: { rol: 'emisor' | 'receptor'; nombre: string; cedula?: string | null }[], imgs: Map<string, { jpeg: Uint8Array; ancho: number; alto: number }>): PdfBloque[] {
  const b: PdfBloque[] = [
    { tipo: 'titulo', texto: `Conduce ${conduceNumero(s.id)}` },
    { tipo: 'texto', texto: `Fecha: ${s.fecha}   Estado: ${s.estado}` },
    { tipo: 'texto', texto: `Origen: ${s.bodega?.nombre ?? '-'}   Destino: ${s.destino_almacen?.nombre ?? s.proyecto?.nombre ?? '-'}` },
    { tipo: 'texto', texto: `Motivo: ${s.motivo ?? '-'}` },
    { tipo: 'texto', texto: `Chofer: ${s.conductor?.nombre ?? '-'}   Vehiculo: ${s.vehiculo?.placa ?? '-'}` },
    { tipo: 'texto', texto: `Entregado por: ${s.despachante_nombre ?? s.entregado?.nombre ?? '-'}   Recibido por: ${s.entrega_receptor ?? s.recibido?.nombre ?? '-'}` },
    { tipo: 'espacio', alto: 8 },
    { tipo: 'fila', cols: ['Codigo', 'Articulo', 'Enviado', 'Recibido'], negrita: true },
  ];
  for (const d of s.detalle_salidas ?? []) {
    b.push({
      tipo: 'fila',
      cols: [d.articulo?.codigo ?? '', d.articulo?.nombre ?? '', `${d.cantidad} ${d.articulo?.unidad ?? ''}`.trim(), d.cantidad_recibida != null ? String(d.cantidad_recibida) : '-'],
    });
  }
  if (s.notas_recepcion) b.push({ tipo: 'espacio' }, { tipo: 'texto', texto: `Notas: ${s.notas_recepcion}` });
  b.push({ tipo: 'espacio', alto: 16 });
  const items = firmas
    .filter((f) => imgs.has(f.rol))
    .map((f) => ({ ...imgs.get(f.rol)!, pie: `${f.rol === 'emisor' ? 'Entrega' : 'Recibe'}: ${f.nombre}${f.cedula ? ' - ' + f.cedula : ''}` }));
  if (items.length) b.push({ tipo: 'imagenes', items });
  return b;
}

/**
 * DS-28 — PDF firmado del conduce guardado en el servidor. Se genera en el cliente
 * al cerrar/firmar (sin librerías: shared/utils/pdf-simple.util), se sube al bucket
 * `conduces` (`salida/<id>/conduce-<uuid>.pdf`) y se registra con la RPC
 * `salida_pdf_firmado_registrar`. El worker de Odoo lo adjunta al picking.
 * Best-effort: un fallo aquí nunca debe impedir el cierre del conduce.
 */
@Injectable({ providedIn: 'root' })
export class ConducePdfService {
  private supabase = inject(SupabaseService);

  /** Descarga una imagen firmada, la pinta sobre fondo blanco y devuelve JPEG (el PDF no maneja alfa). */
  private async aJpeg(url: string): Promise<{ jpeg: Uint8Array; ancho: number; alto: number } | null> {
    try {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob);
      const esc = Math.min(1, 600 / bmp.width);
      const ancho = Math.max(1, Math.round(bmp.width * esc));
      const alto = Math.max(1, Math.round(bmp.height * esc));
      const cv = document.createElement('canvas');
      cv.width = ancho;
      cv.height = alto;
      const ctx = cv.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, ancho, alto);
      ctx.drawImage(bmp, 0, 0, ancho, alto);
      const out = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.85));
      if (!out) return null;
      return { jpeg: new Uint8Array(await out.arrayBuffer()), ancho, alto };
    } catch {
      return null;
    }
  }

  /**
   * Genera, sube y registra el PDF firmado. Devuelve la ruta o null si no se pudo
   * (se traga el error a propósito: la evidencia complementaria no bloquea el cierre).
   */
  async guardarFirmado(s: SalidaInventario, firmas: (SalidaFirma & { url: string | null })[]): Promise<string | null> {
    try {
      const imgs = new Map<string, { jpeg: Uint8Array; ancho: number; alto: number }>();
      for (const f of firmas) {
        if (!f.url) continue;
        const im = await this.aJpeg(f.url);
        if (im) imgs.set(f.rol, im);
      }
      const pdf = construirPdf(bloquesConduce(s, firmas, imgs), `Conduce ${conduceNumero(s.id)}`);
      const path = `salida/${s.id}/conduce-${crypto.randomUUID()}.pdf`;
      const { error } = await this.supabase.client.storage
        .from('conduces')
        .upload(path, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf' });
      if (error) return null;
      const { error: e2 } = await this.supabase.client.rpc('salida_pdf_firmado_registrar', { p_salida: s.id, p_path: path });
      if (e2) return null;
      return path;
    } catch {
      return null;
    }
  }
}
