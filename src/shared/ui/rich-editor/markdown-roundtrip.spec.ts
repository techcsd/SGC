// CQ2 — Prueba de ida y vuelta Markdown → TipTap → Markdown para el editor de
// Dev notes. El storage de `sgc.notas.contenido` sigue siendo Markdown plano
// (regla del repo); este test confirma que abrir una nota existente y guardarla
// de vuelta no pierde CONTENIDO (no exige byte-a-byte idéntico — el espaciado
// puede variar — pero sí que no se coma palabras, marcas de énfasis, filas de
// tabla, casillas de tareas, etc.).
//
// Usa un `Editor` de TipTap SIN montarlo en el DOM real (jsdom crea su propio
// <div> internamente) con las MISMAS extensiones que `<app-rich-editor>`
// (`extensionesNotasRicas()`), para que el test ejerza el editor real, no una
// reimplementación paralela.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensionesNotasRicas, repararListaFantasma } from './rich-editor';

function roundtrip(markdown: string): string {
  const editor = new Editor({ extensions: extensionesNotasRicas(), content: markdown });
  try {
    // Mismo arreglo que corre en `<app-rich-editor>` tras parsear Markdown (ver
    // `repararListaFantasma`) — el test debe ejercer el comportamiento REAL.
    repararListaFantasma(editor);
    return (editor.storage['markdown'].getMarkdown() as string).trim();
  } finally {
    editor.destroy();
  }
}

describe('Markdown → TipTap → Markdown (round-trip de contenido)', () => {
  it('encabezado H1', () => {
    const out = roundtrip('# Título principal');
    expect(out).toContain('Título principal');
    expect(out).toMatch(/^#\s+Título principal/);
  });

  it('encabezado H2', () => {
    const out = roundtrip('## Notas ronda CQ');
    expect(out).toMatch(/^##\s+Notas ronda CQ/);
  });

  it('negrita dentro de una frase', () => {
    const out = roundtrip('Esto es **negrita** en una frase.');
    expect(out).toContain('negrita');
    expect(out).toMatch(/\*\*negrita\*\*/);
  });

  it('cursiva dentro de una frase', () => {
    const out = roundtrip('Esto es *cursiva* de verdad.');
    expect(out).toContain('cursiva');
    expect(out).toMatch(/[*_]cursiva[*_]/);
  });

  it('negrita + cursiva combinadas', () => {
    const out = roundtrip('Un **punto ***muy*** importante**.');
    expect(out).toContain('punto');
    expect(out).toContain('importante');
  });

  it('lista con viñetas', () => {
    const out = roundtrip('- uno\n- dos\n- tres');
    expect(out).toContain('uno');
    expect(out).toContain('dos');
    expect(out).toContain('tres');
    expect(out.match(/^-\s/gm)?.length).toBe(3);
  });

  it('lista numerada', () => {
    const out = roundtrip('1. primero\n2. segundo\n3. tercero');
    expect(out).toContain('primero');
    expect(out).toContain('segundo');
    expect(out).toContain('tercero');
    expect(out).toMatch(/1\.\s+primero/);
  });

  it('checkbox sin marcar', () => {
    const out = roundtrip('- [ ] auditoría: error en «acciones de admin»');
    expect(out).toContain('auditoría: error en «acciones de admin»');
    expect(out).toMatch(/-\s*\[\s?\]/);
  });

  it('checkbox marcado', () => {
    const out = roundtrip('- [x] importar vehículos: mapeo automático');
    expect(out).toContain('importar vehículos: mapeo automático');
    expect(out).toMatch(/-\s*\[[xX]\]/);
  });

  it('checklist mixto (marcado + sin marcar) conserva ambos estados', () => {
    const out = roundtrip('- [ ] pendiente\n- [x] hecho');
    expect(out).toMatch(/-\s*\[\s?\]\s*pendiente/);
    expect(out).toMatch(/-\s*\[[xX]\]\s*hecho/);
  });

  it('bloque de código con lenguaje', () => {
    const out = roundtrip('```sql\nselect * from sgc.audit_log order by created_at desc limit 20;\n```');
    expect(out).toContain('select * from sgc.audit_log');
    expect(out).toContain('```sql');
  });

  it('código inline dentro de una frase', () => {
    const out = roundtrip('Corre `npm run build` antes de subir.');
    expect(out).toContain('npm run build');
    expect(out).toMatch(/`npm run build`/);
  });

  it('tabla con encabezado', () => {
    const md = '| Módulo | Estado |\n| --- | --- |\n| Inventario | OK |\n| Flota | Pendiente |';
    const out = roundtrip(md);
    expect(out).toContain('Módulo');
    expect(out).toContain('Inventario');
    expect(out).toContain('Pendiente');
    expect(out).toContain('|');
  });

  it('enlace con texto', () => {
    const out = roundtrip('Ver [SGC](https://sgcconstructorasd.com) para más detalle.');
    expect(out).toContain('SGC');
    expect(out).toContain('https://sgcconstructorasd.com');
  });

  it('cita (blockquote)', () => {
    const out = roundtrip('> Esto es una cita importante.');
    expect(out).toContain('Esto es una cita importante.');
    expect(out).toMatch(/^>\s/m);
  });

  it('línea horizontal', () => {
    const out = roundtrip('Antes\n\n---\n\nDespués');
    expect(out).toContain('Antes');
    expect(out).toContain('Después');
  });

  it('fragmento HANDOFF (mixto: encabezados + listas + negrita)', () => {
    const md = [
      '# HANDOFF — sesión CQ',
      '',
      '**Fecha:** 16/10/2026',
      '',
      '## Hecho',
      '- Rich editor con TipTap',
      '- Round-trip verificado',
      '',
      '## Pendiente',
      '- [ ] QA manual en dev',
    ].join('\n');
    const out = roundtrip(md);
    expect(out).toContain('HANDOFF — sesión CQ');
    expect(out).toContain('Fecha:');
    expect(out).toContain('16/10/2026');
    expect(out).toContain('Rich editor con TipTap');
    expect(out).toContain('Round-trip verificado');
    expect(out).toMatch(/-\s*\[\s?\]\s*QA manual en dev/);
  });

  it('lista normal seguida de checkboxes con el MISMO marcador (bug de markdown-it-task-lists)', () => {
    // CommonMark fusiona "- uno/- dos" y "- [ ] x" en UN solo <ul> (mismo marcador
    // "-", aunque haya línea en blanco entre medio); eso dejaba un taskList fantasma
    // vacío antes del bulletList real (ver `repararListaFantasma`). No debe perderse
    // ningún ítem ni aparecer una casilla vacía espuria.
    const out = roundtrip('- uno\n- dos\n\n- [ ] x');
    expect(out).toContain('uno');
    expect(out).toContain('dos');
    expect(out).toMatch(/-\s*\[\s?\]\s*x/);
    // Sin casilla vacía espuria antes de "uno".
    expect(out).not.toMatch(/-\s*\[\s?\]\s*\n/);
  });

  it('imagen de nota (CS2): conserva el src nota-img: y el alt', () => {
    const out = roundtrip('Antes.\n\n![captura.png](nota-img:abc/def/00000000-0000-0000-0000-000000000000.png)\n\nDespués.');
    expect(out).toContain('Antes.');
    expect(out).toContain('Después.');
    expect(out).toMatch(/!\[captura\.png\]\(nota-img:abc\/def\/00000000-0000-0000-0000-000000000000\.png\)/);
  });

  it('doble ida y vuelta es estable (idempotente tras la 2ª pasada)', () => {
    const original = '# Notas\n\nUn párrafo con **negrita** y *cursiva*.\n\n- uno\n- dos\n\n- [ ] pendiente\n- [x] hecho';
    const primera = roundtrip(original);
    const segunda = roundtrip(primera);
    expect(segunda).toBe(primera);
  });
});
