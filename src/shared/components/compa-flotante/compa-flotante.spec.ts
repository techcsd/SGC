import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { CompaFlotante } from './compa-flotante';
import { Asistente } from '../../../app/pages/asistente/asistente';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { PreferenciasService, MisPreferencias } from '../../services/preferencias.service';
import { TAMANO_MIN, TAMANO_DEFECTO } from './compa-flotante-geometria.util';

const CLAVE = 'compa.flotante.geometria';

/** Stub del contenido real de /asistente — evita arrastrar toda la cadena de
 *  dependencias de `Asistente` (AsistenteService → SupabaseService, etc.) a un test
 *  que solo quiere probar la BURBUJA/VENTANA (arrastre, resize, persistencia,
 *  montaje perezoso). La lógica de chat en sí ya tiene sus propios specs. */
@Component({ selector: 'app-asistente', template: '<div data-testid="asistente-stub"></div>' })
class AsistenteStub {
  compacto = input(false);
  autoenfocar = input(true);
}

function fakePointerEvent(x: number, y: number): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    target: { closest: () => null },
    currentTarget: { setPointerCapture: () => undefined },
    preventDefault: () => undefined,
  } as unknown as PointerEvent;
}

function montar(prefsIniciales: Partial<MisPreferencias> | null = null) {
  const prefs = signal<MisPreferencias | null>(prefsIniciales as MisPreferencias | null);
  const fakePrefs: Partial<PreferenciasService> = { prefs: prefs.asReadonly() };

  TestBed.configureTestingModule({
    imports: [CompaFlotante],
    providers: [{ provide: PreferenciasService, useValue: fakePrefs }],
  });
  TestBed.overrideComponent(CompaFlotante, { set: { imports: [AsistenteStub, TranslatePipe] } });

  const fixture = TestBed.createComponent(CompaFlotante);
  fixture.detectChanges();
  return fixture;
}

describe('CompaFlotante', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('arranca con la burbuja visible y la ventana oculta', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    expect(comp.abierta()).toBe(false);
    const burbuja = fixture.nativeElement.querySelector('.cf-burbuja') as HTMLElement;
    const ventana = fixture.nativeElement.querySelector('.cf-ventana') as HTMLElement;
    expect(burbuja.hidden).toBe(false);
    expect(ventana.hidden).toBe(true);
  });

  it('abrir() muestra la ventana, oculta la burbuja y monta `app-asistente` (lazy)', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    expect(comp.montada()).toBe(false);

    comp.abrir();
    fixture.detectChanges();

    expect(comp.abierta()).toBe(true);
    expect(comp.montada()).toBe(true);
    const burbuja = fixture.nativeElement.querySelector('.cf-burbuja') as HTMLElement;
    const ventana = fixture.nativeElement.querySelector('.cf-ventana') as HTMLElement;
    expect(burbuja.hidden).toBe(true);
    expect(ventana.hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="asistente-stub"]')).toBeTruthy();
  });

  it('cerrar() NO destruye `app-asistente` — la conversación sobrevive cerrar/abrir (y por tanto un cambio de ruta, que no toca este componente)', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.abrir();
    fixture.detectChanges();
    const stubAntes = fixture.nativeElement.querySelector('[data-testid="asistente-stub"]');

    comp.cerrar();
    fixture.detectChanges();
    expect(comp.abierta()).toBe(false);
    // `montada` no se resetea: el nodo sigue en el DOM, solo oculto.
    expect(comp.montada()).toBe(true);

    comp.abrir();
    fixture.detectChanges();
    const stubDespues = fixture.nativeElement.querySelector('[data-testid="asistente-stub"]');
    expect(stubDespues).toBe(stubAntes); // MISMO nodo → mismo componente, nunca se recreó.
  });

  it('Esc con foco dentro de la ventana la cierra (no la minimiza)', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.abrir();
    fixture.detectChanges();
    const ventana = fixture.nativeElement.querySelector('.cf-ventana') as HTMLElement;
    ventana.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(comp.abierta()).toBe(false);
    expect(comp.minimizada()).toBe(false);
  });

  it('minimizar conserva `abierta` pero oculta el contenido/resize', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.abrir();
    comp.toggleMinimizada();
    fixture.detectChanges();
    expect(comp.abierta()).toBe(true);
    expect(comp.minimizada()).toBe(true);
    expect(fixture.nativeElement.querySelector('.cf-contenido')).toBeFalsy();
  });

  it('arrastrar respeta los límites del viewport (no se puede sacar la ventana de pantalla)', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.abrir();

    comp.onPointerDownBarra(fakePointerEvent(0, 0));
    comp.onPointerMoveBarra(fakePointerEvent(-99999, -99999));
    comp.onPointerUpBarra();

    const pos = comp.posicion()!;
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  it('redimensionar respeta el mínimo 320×380 y el máximo 90% del viewport', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.abrir();

    // Intento de encoger muchísimo → debe quedar en el mínimo.
    comp.onPointerDownResize(fakePointerEvent(500, 500));
    comp.onPointerMoveResize(fakePointerEvent(-9999, -9999));
    comp.onPointerUpResize();
    expect(comp.tamano()).toEqual(TAMANO_MIN);

    // Intento de agrandar muchísimo → topa con el 90% del viewport.
    comp.onPointerDownResize(fakePointerEvent(500, 500));
    comp.onPointerMoveResize(fakePointerEvent(99999, 99999));
    comp.onPointerUpResize();
    expect(comp.tamano().w).toBeLessThanOrEqual(Math.round(window.innerWidth * 0.9));
    expect(comp.tamano().h).toBeLessThanOrEqual(Math.round(window.innerHeight * 0.9));
  });

  it('con "recordar posición" activo, guarda la geometría en localStorage al soltar', () => {
    const fixture = montar({ compa_flotante_recordar_posicion: true } as Partial<MisPreferencias>);
    const comp = fixture.componentInstance;
    comp.abrir();

    comp.onPointerDownBarra(fakePointerEvent(0, 0));
    comp.onPointerMoveBarra(fakePointerEvent(40, 40));
    comp.onPointerUpBarra();

    const guardado = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    expect(guardado).not.toBeNull();
    expect(guardado.posicion).toEqual(comp.posicion());
  });

  it('con "recordar posición" DESACTIVADO, no escribe nada en localStorage', () => {
    const fixture = montar({ compa_flotante_recordar_posicion: false } as Partial<MisPreferencias>);
    const comp = fixture.componentInstance;
    comp.abrir();

    comp.onPointerDownBarra(fakePointerEvent(0, 0));
    comp.onPointerMoveBarra(fakePointerEvent(40, 40));
    comp.onPointerUpBarra();

    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('una siguiente sesión con geometría guardada abre en esa posición, no en la por defecto', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ posicion: { x: 50, y: 60 }, tamano: { w: 400, h: 500 } }));
    const fixture = montar({ compa_flotante_recordar_posicion: true } as Partial<MisPreferencias>);
    const comp = fixture.componentInstance;

    comp.abrir();

    expect(comp.posicion()).toEqual({ x: 50, y: 60 });
    expect(comp.tamano()).toEqual({ w: 400, h: 500 });
  });

  it('con "recordar posición" desactivado, ignora lo guardado y abre en la posición por defecto', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ posicion: { x: 50, y: 60 }, tamano: { w: 400, h: 500 } }));
    const fixture = montar({ compa_flotante_recordar_posicion: false } as Partial<MisPreferencias>);
    const comp = fixture.componentInstance;

    comp.abrir();

    expect(comp.posicion()).not.toEqual({ x: 50, y: 60 });
  });

  it('"anclar" vuelve la ventana a la esquina inferior derecha con el tamaño por defecto', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.abrir();
    comp.onPointerDownResize(fakePointerEvent(0, 0));
    comp.onPointerMoveResize(fakePointerEvent(500, 500));
    comp.onPointerUpResize();

    comp.anclar();

    expect(comp.tamano()).toEqual(TAMANO_DEFECTO);
    expect(comp.posicion()).toEqual({
      x: window.innerWidth - TAMANO_DEFECTO.w - 24,
      y: window.innerHeight - TAMANO_DEFECTO.h - 24,
    });
  });
});
