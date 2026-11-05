/**
 * DB-S10 — parser de export de historial de WhatsApp (.txt), formatos Android
 * y iPhone, fechas estilo dominicano (día/mes/año). Pura, sin dependencias y
 * sin red: solo convierte texto en una lista de mensajes candidatos. El
 * guardado real (`WaGruposService.importarMensajes`, RPC `wa_importar_mensajes`
 * aún pendiente de migración) vive fuera de este archivo.
 */

export type WaChatImportTipo = 'texto' | 'audio' | 'imagen' | 'documento' | 'video' | 'sticker' | 'otro';

export interface WaChatImportMensaje {
  /** Id estable `import:<hash>` — reimportar el mismo archivo no debe duplicar
   *  (idempotencia por contenido: autor + fecha/hora + texto). */
  idImport: string;
  autorNombre: string;
  /** Solo si la línea trae un número reconocible (participante sin contacto guardado). */
  autorTelefono: string | null;
  tipo: WaChatImportTipo;
  texto: string | null;
  /** ISO con offset -04:00 (America/Santo_Domingo, el país no observa horario de verano). */
  enviadoEn: string;
}

export interface WaChatImportResultado {
  mensajes: WaChatImportMensaje[];
  lineasIgnoradas: number;
  formatoDetectado: 'android' | 'iphone' | 'desconocido';
}

const INVISIBLES = /[‎‏﻿]/g;

// Android: "12/4/23, 10:15 - Juan Pérez: Hola" (24h o 12h con a. m./p. m.)
const RE_ANDROID =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\s*-\s*(.*)$/i;
// iPhone: "[12/4/23, 10:15:03 a. m.] Juan Pérez: Hola"
const RE_IPHONE =
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\]\s*(.*)$/i;

const PLACEHOLDERS_MEDIA = [
  'multimedia omitido',
  'imagen omitida',
  'video omitido',
  'audio omitido',
  'documento omitido',
  'sticker omitido',
  'gif omitido',
  'contacto omitido',
  'media omitted',
  'image omitted',
  'video omitted',
  'audio omitted',
  'document omitted',
  'sticker omitted',
  'gif omitted',
  'contact card omitted',
];

function limpiarLinea(linea: string): string {
  return linea.replace(INVISIBLES, '').replace(/\r$/, '');
}

/** Hash sync y estable (djb2) — no necesita ser criptográfico, solo determinista
 *  para que reimportar el mismo archivo genere los mismos `idImport`. */
function hashEstable(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function esPlaceholderMedia(texto: string): boolean {
  const t = texto.toLowerCase().replace(/[<>]/g, '').trim();
  return PLACEHOLDERS_MEDIA.some((p) => t.includes(p));
}

/** Heurística "Nombre: resto" → autor + mensaje. `null` si no parece una línea
 *  de autor real (avisos de sistema: cifrado, alguien entró/salió, etc. — esas
 *  líneas no traen "Nombre: " y se ignoran). */
function separarAutorMensaje(resto: string): { autor: string; texto: string } | null {
  const idx = resto.indexOf(': ');
  if (idx < 0 || idx > 60) return null;
  const autor = resto.slice(0, idx).trim();
  const texto = resto.slice(idx + 2);
  if (!autor) return null;
  return { autor, texto };
}

/** Best-effort: un participante sin contacto guardado aparece como número. */
function extraerTelefono(autor: string): string | null {
  const digitos = autor.replace(/[^\d]/g, '');
  return /^\+?[\d\s()-]{7,}$/.test(autor) && digitos.length >= 7 ? digitos : null;
}

function clasificarTipo(texto: string): WaChatImportTipo {
  return esPlaceholderMedia(texto) ? 'otro' : 'texto';
}

/** Dominicana = día/mes/año. Año de 2 dígitos → 20xx. Hora 12h (a./p. m., con o
 *  sin puntos/espacios) o 24h. Devuelve `null` si no se pudo interpretar. */
function parsearFechaHora(fecha: string, hora: string): string | null {
  const [dStr, mStr, yStr] = fecha.split('/');
  const dia = Number(dStr);
  const mes = Number(mStr);
  let anio = Number(yStr);
  if (!dia || !mes || !anio) return null;
  if (anio < 100) anio += 2000;

  let horas: number;
  let min: number;
  let seg = 0;
  const m12 = hora.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?/i);
  if (m12) {
    horas = Number(m12[1]);
    min = Number(m12[2]);
    seg = Number(m12[3] ?? 0);
    const esPm = m12[4].toLowerCase() === 'p';
    if (esPm && horas < 12) horas += 12;
    if (!esPm && horas === 12) horas = 0;
  } else {
    const m24 = hora.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m24) return null;
    horas = Number(m24[1]);
    min = Number(m24[2]);
    seg = Number(m24[3] ?? 0);
  }
  if (dia > 31 || mes > 12 || horas > 23 || min > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${anio}-${pad(mes)}-${pad(dia)}T${pad(horas)}:${pad(min)}:${pad(seg)}-04:00`;
}

interface MensajeEnCurso {
  autor: string;
  telefono: string | null;
  tipo: WaChatImportTipo;
  textoBruto: string;
  fecha: string;
  hora: string;
}

export function parsearChatWhatsapp(contenido: string): WaChatImportResultado {
  const lineas = contenido.split('\n');
  const mensajes: WaChatImportMensaje[] = [];
  let lineasIgnoradas = 0;
  let formatoDetectado: 'android' | 'iphone' | 'desconocido' = 'desconocido';
  let actual: MensajeEnCurso | null = null;

  const cerrarActual = () => {
    if (!actual) return;
    const enviadoEn = parsearFechaHora(actual.fecha, actual.hora);
    if (!enviadoEn) {
      lineasIgnoradas++;
      actual = null;
      return;
    }
    const texto = actual.textoBruto.trim() || null;
    const base = `${actual.autor}|${enviadoEn}|${texto ?? ''}`;
    mensajes.push({
      idImport: `import:${hashEstable(base)}`,
      autorNombre: actual.autor,
      autorTelefono: actual.telefono,
      tipo: actual.tipo,
      texto,
      enviadoEn,
    });
    actual = null;
  };

  for (const lineaCruda of lineas) {
    const linea = limpiarLinea(lineaCruda);
    if (!linea.trim()) continue;

    const mIphone = linea.match(RE_IPHONE);
    const mAndroid = !mIphone ? linea.match(RE_ANDROID) : null;
    const m = mIphone ?? mAndroid;

    if (m) {
      cerrarActual();
      if (mIphone) formatoDetectado = 'iphone';
      else if (formatoDetectado === 'desconocido') formatoDetectado = 'android';

      const fecha = m[1];
      const hora = m[2];
      const resto = m[3];
      const partido = separarAutorMensaje(resto);
      if (!partido) {
        // Línea de sistema (entró/salió, cifrado, cambio de asunto, etc.) — no es un mensaje real.
        lineasIgnoradas++;
        continue;
      }
      actual = {
        autor: partido.autor,
        telefono: extraerTelefono(partido.autor),
        tipo: clasificarTipo(partido.texto),
        textoBruto: partido.texto,
        fecha,
        hora,
      };
    } else if (actual) {
      // Continuación de un mensaje multilínea.
      actual.textoBruto += `\n${linea}`;
    } else {
      lineasIgnoradas++;
    }
  }
  cerrarActual();

  return { mensajes, lineasIgnoradas, formatoDetectado };
}
