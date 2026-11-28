import { describe, it, expect } from 'vitest';
import { extensionDe, nombreArchivoSeguro } from './descargar-archivo.util';

describe('descargar-archivo.util (EB-18)', () => {
  it('toma la extensión de la URL firmada ignorando el query', () => {
    expect(extensionDe('https://x.supabase.co/storage/v1/object/sign/b/a/foto.PNG?token=abc')).toBe('png');
  });
  it('usa el MIME si la URL no trae extensión', () => {
    expect(extensionDe('https://x/y/z?token=1', 'image/webp')).toBe('webp');
    expect(extensionDe('https://x/y/z', 'image/jpeg')).toBe('jpg');
  });
  it('nombre seguro: sin acentos ni espacios', () => {
    expect(nombreArchivoSeguro('ABC 123 – foto perfil', 'jpg')).toBe('ABC-123-foto-perfil.jpg');
    expect(nombreArchivoSeguro('', 'png')).toBe('archivo.png');
  });
});
