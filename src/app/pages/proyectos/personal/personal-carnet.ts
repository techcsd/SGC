import { Component, ChangeDetectionStrategy, input, signal, effect } from '@angular/core';
import QRCode from 'qrcode';
import { PersonalObra, NACIONALIDAD_LABEL } from '../../../../shared/models/personal-obra.model';

/**
 * AR1/CE3/CE5 — Carnet imprimible del personal de obra.
 * CE3: logo BLANCO sobre la cabecera navy (el negro no se leía).
 * CE5: impresión a tamaño CR80 real (85.60 × 53.98 mm) frente y dorso, con sangrado y
 *   marcas de corte; opción "Hoja A4 con 8" para imprimir en lote; foto 3:4 o iniciales;
 *   QR verificable a /verificar/<carnet> (página pública mínima).
 */
@Component({
  selector: 'app-personal-carnet',
  imports: [],
  templateUrl: './personal-carnet.html',
  styleUrl: './personal-carnet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalCarnet {
  personal = input.required<PersonalObra>();
  fotoDataUrl = input<string | null>(null);
  verifyUrl = input<string>('');

  // CE3 — logo blanco (alfa preservado, 2×) para contraste sobre la cabecera navy.
  readonly logoSrc = 'assets/imgs/logos/csd-no-bg-logo-white.png';
  readonly nacionalidadLabel = NACIONALIDAD_LABEL;

  qr = signal<string>('');

  constructor() {
    effect(() => {
      const url = this.verifyUrl();
      if (url) {
        void QRCode.toDataURL(url, { width: 300, margin: 0 }).then((d) => this.qr.set(d), () => undefined);
      }
    });
  }

  iniciales(p: PersonalObra): string {
    const n = (p.nombre ?? '').trim().charAt(0);
    const a = (p.apellido ?? '').trim().charAt(0);
    return (n + a).toUpperCase() || n.toUpperCase() || '?';
  }

  private async toDataUrl(src: string): Promise<string> {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : '');
        r.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  }

  // ── CSS compartido por impresión individual y en lote (CR80 + sangrado + marcas) ──
  private estilosCR80(): string {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: 'Inter', Arial, Helvetica, sans-serif; background: #e9eef3; }
      /* CR80 real = 85.60 × 53.98 mm. 2 mm de sangrado por lado → caja de corte interior. */
      .sheet { display: flex; flex-wrap: wrap; gap: 10mm; padding: 10mm; justify-content: center; }
      .card-wrap { position: relative; width: 89.6mm; height: 57.98mm; padding: 2mm; } /* bleed box */
      .crop { position: absolute; width: 3mm; height: 3mm; border-color: #111; }
      .crop.tl { top: 0; left: 0; border-top: .2mm solid; border-left: .2mm solid; }
      .crop.tr { top: 0; right: 0; border-top: .2mm solid; border-right: .2mm solid; }
      .crop.bl { bottom: 0; left: 0; border-bottom: .2mm solid; border-left: .2mm solid; }
      .crop.br { bottom: 0; right: 0; border-bottom: .2mm solid; border-right: .2mm solid; }
      .card { width: 85.6mm; height: 53.98mm; background: #fff; border-radius: 3mm; overflow: hidden;
              display: flex; flex-direction: column; box-shadow: 0 0 0 .1mm #ccc; }
      .top { background: #1e3a5f; color: #fff; padding: 2.4mm 3mm; display: flex; align-items: center; gap: 2mm; }
      .top img { height: 6mm; }
      .top b { font-size: 3mm; letter-spacing: .04em; }
      .top small { display: block; font-size: 2.1mm; color: #f8b24a; }
      .body { flex: 1; padding: 2.6mm 3mm; display: flex; gap: 3mm; }
      .foto { width: 21mm; height: 28mm; border-radius: 1.5mm; object-fit: cover; background: #eef1f4; flex-shrink: 0; }
      .ini { width: 21mm; height: 28mm; border-radius: 1.5mm; background: #1e3a5f; color: #fff; flex-shrink: 0;
             display: flex; align-items: center; justify-content: center; font-size: 10mm; font-weight: 700; }
      .info { flex: 1; min-width: 0; }
      .nom { font-size: 3.6mm; font-weight: 700; line-height: 1.15; margin-bottom: 1.4mm; color: #121212; }
      .row { font-size: 2.5mm; margin: .5mm 0; color: #333; }
      .row span { color: #888; }
      .foot { display: flex; align-items: center; justify-content: space-between; padding: 1.6mm 3mm; border-top: .2mm dashed #ccc; }
      .num { font-size: 3mm; font-weight: 700; color: #f97316; }
      .foot small { font-size: 1.9mm; color: #888; }
      .qr { width: 15mm; height: 15mm; }
      /* Dorso */
      .back { justify-content: center; align-items: center; text-align: center; padding: 4mm; flex-direction: column; gap: 2mm; }
      .back .qrbig { width: 24mm; height: 24mm; }
      .back p { font-size: 2.4mm; color: #333; line-height: 1.3; }
      .back .legal { font-size: 2.1mm; color: #888; }
      @page { size: 85.6mm 53.98mm; margin: 0; }
      @media print { body { background: #fff; } .sheet { gap: 0; padding: 0; } .card-wrap { padding: 0; } .crop { display: none; } }
    `;
  }

  private caraFrente(p: PersonalObra, logo: string, foto: string, qr: string): string {
    const cargo = p.cargo ? `${p.cargo.nombre} · ${p.cargo.codigo}` : '—';
    const nac = this.nacionalidadLabel[p.nacionalidad] ?? p.nacionalidad;
    const fotoHtml = foto
      ? `<img class="foto" src="${foto}" alt="">`
      : `<div class="ini">${this.iniciales(p)}</div>`;
    return `<div class="card">
      <div class="top">${logo ? `<img src="${logo}" alt="">` : ''}<div><b>CONSTRUCTORA SD</b><small>CARNET DE PERSONAL DE OBRA</small></div></div>
      <div class="body">
        ${fotoHtml}
        <div class="info">
          <div class="nom">${p.nombre} ${p.apellido ?? ''}</div>
          <div class="row"><span>Cargo:</span> ${cargo}</div>
          <div class="row"><span>Obra:</span> ${p.proyecto?.nombre ?? '—'}</div>
          <div class="row"><span>Nacionalidad:</span> ${nac}</div>
          <div class="row"><span>Documento:</span> ${p.documento_numero ?? '—'}</div>
        </div>
      </div>
      <div class="foot">
        <div><div class="num">${p.carnet_numero ?? 'SIN CARNET'}</div><small>Verifica escaneando el código</small></div>
        ${qr ? `<img class="qr" src="${qr}" alt="QR">` : ''}
      </div>
    </div>`;
  }

  private caraDorso(p: PersonalObra, qr: string, telefono: string): string {
    return `<div class="card back">
      ${qr ? `<img class="qrbig" src="${qr}" alt="QR">` : ''}
      <p><b>${p.carnet_numero ?? ''}</b></p>
      <p class="legal">Este carnet es propiedad de Constructora SD. Si lo encuentras, llama al ${telefono}.</p>
      <p class="legal">Válido mientras el portador esté activo en la obra.</p>
    </div>`;
  }

  private wrap(inner: string): string {
    return `<div class="card-wrap"><span class="crop tl"></span><span class="crop tr"></span><span class="crop bl"></span><span class="crop br"></span>${inner}</div>`;
  }

  /** CE5 — impresión de UN carnet: frente + dorso a tamaño CR80 con marcas de corte. */
  async imprimir(telefono = '(809) 000-0000') {
    const p = this.personal();
    const logo = await this.toDataUrl(this.logoSrc);
    const foto = this.fotoDataUrl() || '';
    const qr = this.qr();
    const win = window.open('', '_blank', 'width=520,height=700');
    if (!win) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Carnet ${p.nombre} ${p.apellido ?? ''}</title>
      <style>${this.estilosCR80()}</style></head><body>
      <div class="sheet">
        ${this.wrap(this.caraFrente(p, logo, foto, qr))}
        ${this.wrap(this.caraDorso(p, qr, telefono))}
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
      </body></html>`;
    win.document.write(html);
    win.document.close();
  }
}
