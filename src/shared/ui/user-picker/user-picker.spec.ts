// CK8 — el user-picker filtra por CÓDIGO de rol (`roles_codigos`), con respaldo por
// nombre normalizado cuando el RPC viejo solo trae nombres. Sin esto, autorizar un
// chofer privado daba "Sin resultados" (se comparaba 'chofer_privado' contra "Chofer privado").
import { describe, it, expect } from 'vitest';
import { usuarioTieneRol, DirectorioUsuario } from './user-picker';

const u = (p: Partial<DirectorioUsuario>): DirectorioUsuario => ({ id: 'x', nombre: 'N', ...p });

describe('usuarioTieneRol', () => {
  it('coincide por código cuando roles_codigos viene (RPC nuevo)', () => {
    const mendez = u({ roles: ['Chofer privado'], roles_codigos: ['chofer_privado'] });
    expect(usuarioTieneRol(mendez, ['chofer_privado'])).toBe(true);
    expect(usuarioTieneRol(mendez, ['chofer_transportista'])).toBe(false);
  });

  it('respaldo por nombre normalizado cuando NO viene roles_codigos (RPC viejo)', () => {
    const viejo = u({ roles: ['Chofer privado'], roles_codigos: null });
    expect(usuarioTieneRol(viejo, ['chofer_privado'])).toBe(true);
  });

  it('no coincide si el usuario no tiene el rol', () => {
    const ing = u({ roles: ['Ingeniero de campo'], roles_codigos: ['ingeniero_campo'] });
    expect(usuarioTieneRol(ing, ['chofer_privado'])).toBe(false);
  });

  it('sin filtro de roles, todos pasan', () => {
    expect(usuarioTieneRol(u({ roles: [] }), [])).toBe(true);
  });
});
