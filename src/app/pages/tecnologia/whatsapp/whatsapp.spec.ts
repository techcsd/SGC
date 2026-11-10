// DL3/DL6 — cálculos puros de la pantalla "Compa en WhatsApp" (F6.8): la
// insignia de aviso de privacidad (DL-04), el indicador de confianza (BS2) y
// que la escalera de seguimiento (DL3) tenga etiqueta/tono para cada estado.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { TecWhatsapp } from './whatsapp';
import { WaHallazgoV2, WaSeguimiento } from '../../../../shared/services/wa-grupos.service';

describe('TecWhatsapp', () => {
  let component: TecWhatsapp;
  let fixture: ComponentFixture<TecWhatsapp>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TecWhatsapp],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TecWhatsapp);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── DL-04 — insignia de aviso de privacidad ────────────────────────────
  it('avisoBadge — grupo ignorado dice "no aplica", sin importar aviso_enviado_en', () => {
    const r = component.avisoBadge({ modo: 'ignorar', aviso_enviado_en: '2026-01-01T00:00:00Z' } as never);
    expect(r.clase).toBe('sgc-badge--neutral');
    expect(r.texto).toContain('No aplica');
  });

  it('avisoBadge — aviso_enviado_en presente (modo memoria/consulta) marca publicado', () => {
    const r = component.avisoBadge({ modo: 'memoria', aviso_enviado_en: '2026-01-01T00:00:00Z' } as never);
    expect(r.clase).toBe('sgc-badge--success');
    expect(r.texto).toContain('publicado');
  });

  it('avisoBadge — sin aviso_enviado_en (memoria/consulta) marca sin confirmar', () => {
    const r = component.avisoBadge({ modo: 'consulta', aviso_enviado_en: null } as never);
    expect(r.clase).toBe('sgc-badge--neutral');
    expect(r.texto).toContain('sin confirmar');
  });

  // ── BS2 — confianza como indicador, nunca verdad absoluta ──────────────
  it('confianzaPct — null/undefined devuelve null (sin indicador)', () => {
    expect(component.confianzaPct({ confianza: null } as never)).toBeNull();
  });

  it('confianzaPct — redondea a porcentaje entero', () => {
    expect(component.confianzaPct({ confianza: 0.756 } as never)).toBe(76);
  });

  it('confianzaTono — umbrales success(≥75)/warning(≥40)/danger', () => {
    expect(component.confianzaTono({ confianza: 0.9 } as never)).toBe('success');
    expect(component.confianzaTono({ confianza: 0.5 } as never)).toBe('warning');
    expect(component.confianzaTono({ confianza: 0.1 } as never)).toBe('danger');
  });

  // ── DL3 — escalera de seguimiento: toda clave tiene etiqueta y tono ────
  it('seguimientoLabel/seguimientoTono cubren los 6 estados de WaSeguimiento', () => {
    const estados: WaSeguimiento[] = ['sin', 'activo', 'resuelto_probable', 'resuelto', 'vencido', 'pausado'];
    for (const e of estados) {
      expect(component.seguimientoLabel[e]).toBeTruthy();
      expect(component.seguimientoTono[e]).toBeTruthy();
    }
  });

  // ── Filtro por persona (client-side sobre `personas` ya cargado) ───────
  it('hallazgosVisibles — filtra por nombre/teléfono de persona mencionada', () => {
    const base: Partial<WaHallazgoV2>[] = [
      { id: '1', personas: [{ nombre: 'Mendez' }] },
      { id: '2', personas: [{ nombre: 'Carlos' }] },
    ];
    component.hallazgos.set(base as WaHallazgoV2[]);
    component.filtroHallazgoPersona.set('mend');
    expect(component.hallazgosVisibles().map((h) => h.id)).toEqual(['1']);
  });

  it('hallazgosVisibles — sin filtro devuelve todos', () => {
    const base: Partial<WaHallazgoV2>[] = [{ id: '1', personas: [] }, { id: '2', personas: [] }];
    component.hallazgos.set(base as WaHallazgoV2[]);
    component.filtroHallazgoPersona.set('');
    expect(component.hallazgosVisibles().length).toBe(2);
  });
});
