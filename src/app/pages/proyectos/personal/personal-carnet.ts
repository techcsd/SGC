import { Component, ChangeDetectionStrategy, input, signal, effect } from '@angular/core';
import QRCode from 'qrcode';
import { PersonalObra, NACIONALIDAD_LABEL } from '../../../../shared/models/personal-obra.model';

/**
 * AR1 — Carnet imprimible del personal de obra: foto, nombre, cargo + ID del cargo,
 * obra, nacionalidad, número de carnet y QR que abre el expediente (verificación).
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

  readonly logoSrc = 'assets/imgs/logos/csd-no-bg-logo.png';
  readonly nacionalidadLabel = NACIONALIDAD_LABEL;

  qr = signal<string>('');

  constructor() {
    effect(() => {
      const url = this.verifyUrl();
      if (url) {
        void QRCode.toDataURL(url, { width: 240, margin: 1 }).then((d) => this.qr.set(d), () => undefined);
      }
    });
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

  /** Abre una ventana de impresión con el carnet aislado (para imprimir / guardar como PDF). */
  async imprimir() {
    const p = this.personal();
    const logo = await this.toDataUrl(this.logoSrc);
    const foto = this.fotoDataUrl() || '';
    const qr = this.qr();
    const cargo = p.cargo ? `${p.cargo.nombre} · ${p.cargo.codigo}` : '—';
    const nac = this.nacionalidadLabel[p.nacionalidad] ?? p.nacionalidad;
    const win = window.open('', '_blank', 'width=420,height=680');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Carnet ${p.nombre} ${p.apellido ?? ''}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; padding: 16px; background: #eee; }
        .carnet { width: 340px; margin: 0 auto; background: #fff; border-radius: 14px; overflow: hidden; border: 1px solid #ddd; }
        .top { background: #121212; color: #fff; padding: 12px 14px; display: flex; align-items: center; gap: 10px; }
        .top img { height: 30px; }
        .top b { font-size: 13px; letter-spacing: .04em; }
        .top small { display:block; font-size: 10px; color:#ffb300; }
        .body { padding: 14px; display: flex; gap: 12px; }
        .foto { width: 96px; height: 116px; border-radius: 8px; object-fit: cover; background:#f0f0f0; border:1px solid #ddd; }
        .info { flex: 1; }
        .nom { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
        .row { font-size: 12px; margin: 2px 0; }
        .row span { color: #777; }
        .foot { display:flex; align-items:center; justify-content: space-between; padding: 10px 14px 14px; border-top: 1px dashed #ddd; }
        .num { font-size: 13px; font-weight: 700; color:#ff5f00; }
        .qr { width: 74px; height: 74px; }
        @media print { body { background: #fff; padding: 0; } .carnet { border: none; } }
      </style></head><body>
      <div class="carnet">
        <div class="top">${logo ? `<img src="${logo}" alt="">` : ''}<div><b>CONSTRUCTORA SD</b><small>CARNET DE PERSONAL DE OBRA</small></div></div>
        <div class="body">
          ${foto ? `<img class="foto" src="${foto}" alt="">` : `<div class="foto"></div>`}
          <div class="info">
            <div class="nom">${p.nombre} ${p.apellido ?? ''}</div>
            <div class="row"><span>Cargo:</span> ${cargo}</div>
            <div class="row"><span>Obra:</span> ${p.proyecto?.nombre ?? '—'}</div>
            <div class="row"><span>Nacionalidad:</span> ${nac}</div>
            <div class="row"><span>Documento:</span> ${p.documento_numero ?? '—'}</div>
          </div>
        </div>
        <div class="foot">
          <div><div class="num">${p.carnet_numero ?? 'SIN CARNET'}</div><div style="font-size:10px;color:#777;">Verifica escaneando el código</div></div>
          ${qr ? `<img class="qr" src="${qr}" alt="QR">` : ''}
        </div>
      </div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
      </body></html>`);
    win.document.close();
  }
}
