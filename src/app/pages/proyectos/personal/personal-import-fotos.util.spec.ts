import { describe, it, expect } from 'vitest';
import {
  conReintento, emparejarFotos, estimarCosto, filaPorAnclaje, normalizarDocumento, procesarConConcurrencia,
  resumenAsignaciones, sugerirFilas, vincularFilasConPersonal, type FilaFoto, type FotoEntrada, type LecturaCedula,
} from './personal-import-fotos.util';
import {
  esEntradaImagenZip, mapearRid, parsearAnclajes, parsearRelaciones, resolverRuta, rutaDrawingDeHoja, rutaPrimeraHoja, rutaRels,
} from './personal-import-xlsx-imagenes.util';

// Datos SINTÉTICOS (ninguna cédula real).
const FILAS: FilaFoto[] = [
  { indice: 0, nombre: 'Juan Perez', documento: '001-0000000-1', filaExcel: 5 },
  { indice: 1, nombre: 'Maria Gomez', documento: '00200000002', filaExcel: 6 },
  { indice: 2, nombre: 'Carlos Ramirez', documento: '003-0000000-3', filaExcel: 7 },
  { indice: 3, nombre: 'Carlos Ramirez', documento: '004-0000000-4', filaExcel: 8 }, // homónimo
  { indice: 4, nombre: 'Pierre Louis', documento: 'HT123456', filaExcel: 9 },
  { indice: 5, nombre: 'Rosa Sin Documento', documento: null, filaExcel: 10 },
];

const lec = (p: Partial<LecturaCedula> = {}): LecturaCedula => ({
  tipo_imagen: 'cedula_frente', documento_numero: null, nombre: null, apellido: null, confianza: 0.95, ...p,
});
const foto = (id: string, l: LecturaCedula | null, extra: Partial<FotoEntrada> = {}): FotoEntrada => ({
  id, origen: 'zip', nombreArchivo: `${id}.jpg`, lectura: l, ...extra,
});
const una = (f: FotoEntrada) => emparejarFotos(FILAS, [f])[0];

describe('normalizarDocumento', () => {
  it('cédula con y sin guiones es la misma', () => {
    expect(normalizarDocumento('001-0000000-1')).toBe('00100000001');
    expect(normalizarDocumento('00100000001')).toBe('00100000001');
    expect(normalizarDocumento(' ht-123 456 ')).toBe('HT123456');
    expect(normalizarDocumento(null)).toBe('');
  });
});

describe('emparejarFotos — documento', () => {
  it('cédula CON guiones en la foto y SIN guiones en el Excel (y al revés)', () => {
    expect(una(foto('a', lec({ documento_numero: '002-0000000-2', nombre: 'Maria', apellido: 'Gomez' })))).toMatchObject({ filaIndice: 1, via: 'documento', tipoDestino: 'documento' });
    expect(una(foto('b', lec({ documento_numero: '00100000001' })))).toMatchObject({ filaIndice: 0, via: 'documento' });
  });

  it('pasaporte alfanumérico', () => {
    expect(una(foto('p', lec({ tipo_imagen: 'pasaporte', documento_numero: 'ht 123456' })))).toMatchObject({ filaIndice: 4, via: 'documento', tipoDestino: 'documento' });
  });

  it('persona con documento → persona_carnet_cedula', () => {
    expect(una(foto('pc', lec({ tipo_imagen: 'persona_con_documento', documento_numero: '00100000001' })))).toMatchObject({ filaIndice: 0, tipoDestino: 'persona_carnet_cedula' });
  });

  it('cédula que NO está en el Excel → Sin asignar (no cae por nombre a otra persona con documento)', () => {
    const a = una(foto('x', lec({ documento_numero: '009-9999999-9', nombre: 'Juan', apellido: 'Perez' })));
    expect(a.filaIndice).toBeNull();
    expect(a.motivo).toBe('no_en_excel');
  });

  it('número casi igual (un dígito mal leído) → Sin asignar con SUGERENCIA, nunca auto', () => {
    const a = una(foto('x', lec({ documento_numero: '001-0000000-7' })));
    expect(a.filaIndice).toBeNull();
    expect(a.sugerencias).toContain(0);
  });

  it('número leído que no está pero el nombre calza con una fila SIN documento → se asigna a esa', () => {
    expect(una(foto('r', lec({ documento_numero: '777-7777777-7', nombre: 'Rosa', apellido: 'Sin Documento' })))).toMatchObject({ filaIndice: 5, via: 'nombre' });
  });

  it('documento coincide pero el nombre leído es de otra persona → conflicto marcado', () => {
    const a = una(foto('c', lec({ documento_numero: '00100000001', nombre: 'Maria', apellido: 'Gomez' })));
    expect(a).toMatchObject({ filaIndice: 0, via: 'documento', conflicto: true });
  });
});

describe('emparejarFotos — nombre', () => {
  it('sin número: nombre exacto (orden y acentos no importan)', () => {
    expect(una(foto('n', lec({ nombre: 'MARÍA', apellido: 'GÓMEZ' })))).toMatchObject({ filaIndice: 1, via: 'nombre' });
    expect(una(foto('n2', lec({ tipo_imagen: 'pasaporte', nombre: 'Louis', apellido: 'Pierre' })))).toMatchObject({ filaIndice: 4, via: 'nombre' });
  });

  it('nombre más largo que contiene al del Excel (único) → muy alto → asigna', () => {
    expect(una(foto('n', lec({ nombre: 'Juan Carlos', apellido: 'Perez' })))).toMatchObject({ filaIndice: 0, via: 'nombre' });
  });

  it('dos personas con el mismo nombre y sin número → ambiguo, NO adivina, ofrece ambas', () => {
    const a = una(foto('h', lec({ nombre: 'Carlos', apellido: 'Ramirez' })));
    expect(a.filaIndice).toBeNull();
    expect(a.motivo).toBe('ambiguo');
    expect(a.sugerencias.sort()).toEqual([2, 3]);
  });

  it('dos homónimos pero el NÚMERO desempata (documento gana)', () => {
    expect(una(foto('h', lec({ documento_numero: '004-0000000-4', nombre: 'Carlos', apellido: 'Ramirez' })))).toMatchObject({ filaIndice: 3, via: 'documento', conflicto: false });
  });

  it('una sola palabra de nombre no identifica a nadie', () => {
    expect(una(foto('n', lec({ nombre: 'Juan' }))).filaIndice).toBeNull();
  });
});

describe('emparejarFotos — confianza, ilegibles y otras', () => {
  it('confianza < umbral → Sin asignar', () => {
    const a = una(foto('l', lec({ documento_numero: '00100000001', confianza: 0.6 })));
    expect(a.filaIndice).toBeNull();
    expect(a.motivo).toBe('baja_confianza');
  });

  it('el umbral es configurable', () => {
    const f = foto('l', lec({ documento_numero: '00100000001', confianza: 0.6 }));
    expect(emparejarFotos(FILAS, [f], 0.5)[0].filaIndice).toBe(0);
  });

  it('foto ilegible (sin número ni nombre) → Sin asignar «ilegible»', () => {
    expect(una(foto('i', lec({ confianza: 0.9 }))).motivo).toBe('ilegible');
  });

  it('error de lectura → Sin asignar, el lote sigue', () => {
    const r = emparejarFotos(FILAS, [foto('e', null, { error: 'timeout' }), foto('ok', lec({ documento_numero: '00200000002' }))]);
    expect(r[0].motivo).toBe('error');
    expect(r[1].filaIndice).toBe(1);
  });

  it('imagen «otra» sin ancla → Sin asignar', () => {
    expect(una(foto('o', lec({ tipo_imagen: 'otra' }))).motivo).toBe('otra');
  });
});

describe('emparejarFotos — duplicadas / conflictivas', () => {
  it('dos fotos del mismo cupo: gana la de documento+confianza; la otra queda duplicada', () => {
    const r = emparejarFotos(FILAS, [
      foto('a', lec({ documento_numero: '00100000001', confianza: 0.9 })),
      foto('b', lec({ documento_numero: '001-0000000-1', confianza: 0.99 })),
    ]);
    expect(r.find((x) => x.fotoId === 'b')?.duplicada).toBe(false);
    expect(r.find((x) => x.fotoId === 'a')?.duplicada).toBe(true);
    expect(resumenAsignaciones(r)).toMatchObject({ asignadas: 1, duplicadas: 1, sinAsignar: 0 });
  });

  it('frente gana al reverso aunque el reverso venga con más confianza', () => {
    const r = emparejarFotos(FILAS, [
      foto('dorso', lec({ tipo_imagen: 'cedula_dorso', documento_numero: '00100000001', confianza: 0.99 })),
      foto('frente', lec({ tipo_imagen: 'cedula_frente', documento_numero: '00100000001', confianza: 0.9 })),
    ]);
    expect(r.find((x) => x.fotoId === 'frente')?.duplicada).toBe(false);
    expect(r.find((x) => x.fotoId === 'dorso')?.duplicada).toBe(true);
  });

  it('cédula y persona-con-cédula de la misma fila NO compiten (cupos distintos)', () => {
    const r = emparejarFotos(FILAS, [
      foto('c', lec({ documento_numero: '00100000001' })),
      foto('p', lec({ tipo_imagen: 'persona_con_documento', documento_numero: '00100000001' })),
    ]);
    expect(r.every((x) => !x.duplicada)).toBe(true);
  });
});

describe('anclaje de imágenes incrustadas', () => {
  it('filaPorAnclaje: una fila dentro, varias → la del centro, empate → ninguna', () => {
    expect(filaPorAnclaje({ desde: 5, hasta: 5 }, FILAS)).toBe(0);
    expect(filaPorAnclaje({ desde: 5, hasta: 7 }, FILAS)).toBe(1);
    expect(filaPorAnclaje({ desde: 5, hasta: 6 }, FILAS)).toBeNull();
    expect(filaPorAnclaje({ desde: 50, hasta: 50 }, FILAS)).toBeNull();
    expect(filaPorAnclaje(null, FILAS)).toBeNull();
  });

  it('foto ilegible pero anclada a una fila → se asigna por anclaje', () => {
    expect(una(foto('x', lec({ confianza: 0.4 }), { origen: 'xlsx', ancla: { desde: 6, hasta: 6 } }))).toMatchObject({ filaIndice: 1, via: 'anclaje', tipoDestino: 'documento' });
  });

  it('foto de la persona incrustada («otra») → persona por anclaje', () => {
    expect(una(foto('x', lec({ tipo_imagen: 'otra', confianza: 0.9 }), { origen: 'xlsx', ancla: { desde: 5, hasta: 5 } }))).toMatchObject({ filaIndice: 0, via: 'anclaje', tipoDestino: 'persona' });
  });

  it('el número manda sobre el anclaje, pero si discrepan queda marcado conflicto', () => {
    const a = una(foto('x', lec({ documento_numero: '00200000002' }), { origen: 'xlsx', ancla: { desde: 5, hasta: 5 } }));
    expect(a).toMatchObject({ filaIndice: 1, via: 'documento', conflicto: true });
  });

  it('homónimos sin número se desempatan por el anclaje', () => {
    expect(una(foto('x', lec({ nombre: 'Carlos', apellido: 'Ramirez' }), { origen: 'xlsx', ancla: { desde: 8, hasta: 8 } }))).toMatchObject({ filaIndice: 3, via: 'anclaje' });
  });
});

describe('sugerirFilas / estimarCosto', () => {
  it('máximo 3, mejor primero', () => {
    const s = sugerirFilas('00100000009', 'Juan Perez', FILAS);
    expect(s[0]).toBe(0);
    expect(s.length).toBeLessThanOrEqual(3);
  });
  it('costo estimado', () => {
    expect(estimarCosto(150)).toEqual({ imagenes: 150, usd: 0.45 });
  });
});

describe('concurrencia y reintento', () => {
  it('nunca excede el límite y un fallo no corta el lote', async () => {
    let enVuelo = 0, maximo = 0;
    const r = await procesarConConcurrencia([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      enVuelo++; maximo = Math.max(maximo, enVuelo);
      await new Promise((res) => setTimeout(res, 2));
      enVuelo--;
      if (n === 4) throw new Error('boom');
      return n * 2;
    });
    expect(maximo).toBeLessThanOrEqual(3);
    expect(r.filter((x) => 'ok' in x).length).toBe(6);
    expect('error' in r[3]).toBe(true);
  });

  it('parar() omite los pendientes', async () => {
    let n = 0;
    const r = await procesarConConcurrencia([1, 2, 3, 4], 1, async () => { n++; }, { parar: () => n >= 2 });
    expect(r.filter((x) => 'omitido' in x).length).toBe(2);
  });

  it('conReintento reintenta y devuelve el éxito', async () => {
    let intentos = 0;
    const v = await conReintento(async () => { if (++intentos < 2) throw new Error('x'); return 'ok'; }, 3, 0);
    expect(v).toBe('ok');
    expect(intentos).toBe(2);
  });
  it('conReintento propaga el último error', async () => {
    await expect(conReintento(async () => { throw new Error('siempre'); }, 2, 0)).rejects.toThrow('siempre');
  });
});

// ── xlsx: imágenes incrustadas ───────────────────────────────────────────────
const WORKBOOK = '<workbook xmlns:r="x"><sheets><sheet name="LISTADO" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/></sheets></workbook>';
const WB_RELS = '<Relationships><Relationship Id="rId2" Type="t/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="http://x/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
const SHEET_RELS = '<Relationships><Relationship Id="rId1" Type="http://x/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>';
const DRAWING = `<xdr:wsDr xmlns:xdr="a" xmlns:a="b" xmlns:r="c">
<xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>1000</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>
<xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1" cy="1"/>
<xdr:pic><xdr:blipFill><a:blip r:embed="rId2" cstate="print"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>
<xdr:twoCellAnchor><xdr:from><xdr:row>2</xdr:row></xdr:from><xdr:to><xdr:row>9</xdr:row></xdr:to><xdr:graphicFrame/></xdr:twoCellAnchor>
</xdr:wsDr>`;
const DRAW_RELS = '<Relationships><Relationship Id="rId1" Type="http://x/relationships/image" Target="../media/image1.png"/><Relationship Target="../media/image2.jpeg" Id="rId2" Type="http://x/relationships/image"/></Relationships>';

describe('xlsx imágenes', () => {
  it('encuentra la 1ª hoja, su drawing y los anclajes (ignora gráficos; borde exacto no cuenta)', () => {
    const hoja = rutaPrimeraHoja(WORKBOOK, WB_RELS);
    expect(hoja).toBe('xl/worksheets/sheet1.xml');
    expect(rutaRels(hoja as string)).toBe('xl/worksheets/_rels/sheet1.xml.rels');
    expect(rutaDrawingDeHoja(hoja as string, SHEET_RELS)).toBe('xl/drawings/drawing1.xml');
    expect(parsearAnclajes(DRAWING)).toEqual([
      { rid: 'rId1', ancla: { desde: 5, hasta: 5 } },
      { rid: 'rId2', ancla: { desde: 8, hasta: 8 } },
    ]);
    const m = mapearRid('xl/drawings/drawing1.xml', DRAW_RELS);
    expect(m.get('rId1')).toBe('xl/media/image1.png');
    expect(m.get('rId2')).toBe('xl/media/image2.jpeg');
  });

  it('resolverRuta maneja .., absolutas y relativas', () => {
    expect(resolverRuta('xl/drawings', '../media/a.png')).toBe('xl/media/a.png');
    expect(resolverRuta('xl/drawings', '/xl/media/a.png')).toBe('xl/media/a.png');
    expect(resolverRuta('xl', 'worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(parsearRelaciones(DRAW_RELS).length).toBe(2);
  });

  it('esEntradaImagenZip filtra carpetas, __MACOSX, ocultos y no-imágenes', () => {
    expect(esEntradaImagenZip('fotos/juan.JPG')).toBe(true);
    expect(esEntradaImagenZip('fotos/')).toBe(false);
    expect(esEntradaImagenZip('__MACOSX/fotos/._juan.jpg')).toBe(false);
    expect(esEntradaImagenZip('fotos/.DS_Store')).toBe(false);
    expect(esEntradaImagenZip('lista.xlsx')).toBe(false);
  });
});

describe('asignación manual y preferidas', () => {
  it('manual manda: una foto ambigua/ilegible se asigna a la fila elegida', () => {
    const f = foto('m', lec({ confianza: 0.3 }));
    const a = emparejarFotos(FILAS, [f], 0.85, { manual: new Map([['m', 3]]) })[0];
    expect(a).toMatchObject({ filaIndice: 3, via: 'manual', tipoDestino: 'documento', motivo: null });
  });

  it('manual sobre una foto «otra» → persona; fila inexistente se ignora', () => {
    const f = foto('m', lec({ tipo_imagen: 'otra' }));
    expect(emparejarFotos(FILAS, [f], 0.85, { manual: new Map([['m', 1]]) })[0].tipoDestino).toBe('persona');
    expect(emparejarFotos(FILAS, [f], 0.85, { manual: new Map([['m', 99]]) })[0].filaIndice).toBeNull();
  });

  it('«preferidas» cambia cuál de las duplicadas gana', () => {
    const fs = [
      foto('a', lec({ documento_numero: '00100000001', confianza: 0.99 })),
      foto('b', lec({ documento_numero: '00100000001', confianza: 0.9 })),
    ];
    const r = emparejarFotos(FILAS, fs, 0.85, { preferidas: new Set(['b']) });
    expect(r.find((x) => x.fotoId === 'b')?.duplicada).toBe(false);
    expect(r.find((x) => x.fotoId === 'a')?.duplicada).toBe(true);
  });
});

describe('vincularFilasConPersonal', () => {
  const personal = [
    { id: 'p0', nombre: 'Juan Perez', documento_numero: '001-0000000-1', lote_import: 'L' },
    { id: 'p5', nombre: 'ROSA sin documento', documento_numero: null, lote_import: 'L' },
    { id: 'px', nombre: 'Rosa Sin Documento', documento_numero: null, lote_import: 'OTRO' },
  ];
  it('por documento sin guiones y por nombre único del lote', () => {
    const m = vincularFilasConPersonal(FILAS, personal, 'L');
    expect(m.get(0)).toBe('p0');
    expect(m.get(5)).toBe('p5');
    expect(m.has(1)).toBe(false);
  });
  it('nombre repetido en el lote → no adivina', () => {
    const dup = [...personal, { id: 'p5b', nombre: 'Rosa Sin Documento', documento_numero: null, lote_import: 'L' }];
    expect(vincularFilasConPersonal(FILAS, dup, 'L').has(5)).toBe(false);
  });
});
