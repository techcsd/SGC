import { describe, it, expect } from 'vitest';
import { markdownAPlano } from './markdown-a-plano.util';

describe('markdownAPlano (CQ2 — Mandar a ronda)', () => {
  it('quita negrita y cursiva', () => {
    expect(markdownAPlano('Esto es **negrita** y esto *cursiva*.')).toBe('Esto es negrita y esto cursiva.');
  });

  it('convierte encabezados a texto plano', () => {
    expect(markdownAPlano('# Notas ronda CQ')).toBe('Notas ronda CQ');
    expect(markdownAPlano('## Subtítulo')).toBe('Subtítulo');
  });

  it('convierte checkboxes a glifos ☐/☑', () => {
    const out = markdownAPlano('- [ ] pendiente\n- [x] hecho');
    expect(out).toBe('☐ pendiente\n☑ hecho');
  });

  it('deja listas con viñetas legibles', () => {
    expect(markdownAPlano('- uno\n- dos')).toBe('- uno\n- dos');
  });

  it('convierte enlaces a "texto (url)"', () => {
    expect(markdownAPlano('Ver [SGC](https://sgcconstructorasd.com) para más.')).toBe(
      'Ver SGC (https://sgcconstructorasd.com) para más.',
    );
  });

  it('quita backticks de código inline y conserva bloques de código', () => {
    expect(markdownAPlano('Corre `npm run build`.')).toBe('Corre npm run build.');
    const bloque = markdownAPlano('```sql\nselect 1;\n```');
    expect(bloque).toBe('select 1;');
  });

  it('no pierde contenido real en un fragmento mixto', () => {
    const md = '# Notas ronda CQ\n\n**Importante:** revisar auditoría.\n\n- [ ] auditoría: error en «acciones de admin»\n- [x] importar vehículos: mapeo automático';
    const out = markdownAPlano(md);
    expect(out).toContain('Notas ronda CQ');
    expect(out).toContain('Importante:');
    expect(out).toContain('revisar auditoría.');
    expect(out).toContain('☐ auditoría: error en «acciones de admin»');
    expect(out).toContain('☑ importar vehículos: mapeo automático');
  });
});
