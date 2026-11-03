import { describe, it, expect } from 'vitest';
import { esAtajoCtrlK, esAtajoBarra, esCampoDeTexto } from './atajo-buscador.util';

describe('esAtajoCtrlK', () => {
  it('Ctrl+K (Windows/Linux)', () => {
    expect(esAtajoCtrlK({ key: 'k', ctrlKey: true })).toBe(true);
  });
  it('Cmd+K (Mac, metaKey)', () => {
    expect(esAtajoCtrlK({ key: 'K', metaKey: true })).toBe(true);
  });
  it('no dispara con K sola (sin ctrl/cmd)', () => {
    expect(esAtajoCtrlK({ key: 'k' })).toBe(false);
  });
  it('no dispara con Ctrl + otra tecla', () => {
    expect(esAtajoCtrlK({ key: 's', ctrlKey: true })).toBe(false);
  });
});

describe('esCampoDeTexto', () => {
  it('input/textarea/select cuentan como campo de texto', () => {
    expect(esCampoDeTexto({ tagName: 'INPUT' })).toBe(true);
    expect(esCampoDeTexto({ tagName: 'TEXTAREA' })).toBe(true);
    expect(esCampoDeTexto({ tagName: 'SELECT' })).toBe(true);
  });
  it('contenteditable cuenta aunque el tag no sea de formulario', () => {
    expect(esCampoDeTexto({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
  it('un botón o div normal NO cuenta', () => {
    expect(esCampoDeTexto({ tagName: 'DIV' })).toBe(false);
    expect(esCampoDeTexto({ tagName: 'BUTTON' })).toBe(false);
  });
  it('null/undefined no rompe, devuelve false', () => {
    expect(esCampoDeTexto(null)).toBe(false);
    expect(esCampoDeTexto(undefined)).toBe(false);
  });
});

describe('esAtajoBarra ("/")', () => {
  it('abre si no está ya abierto y el foco no está en un campo de texto', () => {
    expect(esAtajoBarra({ key: '/' }, { buscadorYaAbierto: false, focoEnCampoDeTexto: false })).toBe(true);
  });
  it('NO abre si ya está abierto (evita reabrir/parpadeo)', () => {
    expect(esAtajoBarra({ key: '/' }, { buscadorYaAbierto: true, focoEnCampoDeTexto: false })).toBe(false);
  });
  it('NO abre si el foco está en un campo de texto (p. ej. escribiendo "precio/u")', () => {
    expect(esAtajoBarra({ key: '/' }, { buscadorYaAbierto: false, focoEnCampoDeTexto: true })).toBe(false);
  });
  it('otras teclas no disparan', () => {
    expect(esAtajoBarra({ key: 'k' }, { buscadorYaAbierto: false, focoEnCampoDeTexto: false })).toBe(false);
  });
});
