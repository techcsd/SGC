import { describe, it, expect } from 'vitest';
import { resolverPerfil, PERFIL_DEFAULT } from './perfiles';

/**
 * CN4 — el saludo de bienvenida respeta la PRIORIDAD de roles (contrato con la app).
 * El bug de la app era saludar a un admin como "ingeniero".
 */
describe('resolverPerfil (bienvenida)', () => {
  it('admin → Administración', () => {
    expect(resolverPerfil(['admin']).modulo).toBe('Administración');
  });

  it('admin + ingeniero_campo → Administración (admin manda)', () => {
    expect(resolverPerfil(['ingeniero_campo', 'admin']).modulo).toBe('Administración');
  });

  it('gerencia → Dirección', () => {
    expect(resolverPerfil(['gerencia']).modulo).toBe('Dirección');
  });

  it('ingeniero_campo → Obra', () => {
    expect(resolverPerfil(['ingeniero_campo']).modulo).toBe('Obra');
  });

  it('sin roles → perfil genérico', () => {
    expect(resolverPerfil([])).toEqual(PERFIL_DEFAULT);
  });

  it('un rol desconocido → perfil genérico', () => {
    expect(resolverPerfil(['rol_que_no_existe'])).toEqual(PERFIL_DEFAULT);
  });
});
