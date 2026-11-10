// _shared/zip.ts — DM1 (ronda DM, PROMPT 140 F1). Lector/escritor ZIP mínimo,
// sin dependencias externas: usa DecompressionStream/CompressionStream('deflate-raw')
// nativos de Deno para los métodos STORE (0) y DEFLATE (8), los dos únicos que
// producen las herramientas de zip normales (Explorer, 7-Zip, macOS Archive).
// No soporta cifrado ni ZIP64 (no aplica a un paquete de skills de pocos KB).

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  crc32: number;
}

function readUint32LE(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24 >>> 0);
}
function readUint16LE(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

/** Lee el Central Directory (nombres + offsets), sin descomprimir nada. */
export function readZipCentralDirectory(buf: Uint8Array): ZipEntry[] {
  // Busca la firma EOCD desde el final (el comentario del zip, si existe, es corto).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (readUint32LE(buf, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("No parece un archivo .zip válido (falta el End Of Central Directory).");

  const entryCount = readUint16LE(buf, eocd + 10);
  const cdOffset = readUint32LE(buf, eocd + 16);

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (readUint32LE(buf, p) !== CDH_SIG) throw new Error("Central Directory corrupto o formato no soportado.");
    const compressionMethod = readUint16LE(buf, p + 10);
    const crc32 = readUint32LE(buf, p + 16);
    const compressedSize = readUint32LE(buf, p + 20);
    const uncompressedSize = readUint32LE(buf, p + 24);
    const nameLen = readUint16LE(buf, p + 28);
    const extraLen = readUint16LE(buf, p + 30);
    const commentLen = readUint16LE(buf, p + 32);
    const localHeaderOffset = readUint32LE(buf, p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset, crc32 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extrae y descomprime (si hace falta) el contenido de una entrada. */
export async function extractZipEntry(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const p = entry.localHeaderOffset;
  if (readUint32LE(buf, p) !== LFH_SIG) throw new Error(`Local File Header inválido para "${entry.name}".`);
  const nameLen = readUint16LE(buf, p + 26);
  const extraLen = readUint16LE(buf, p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed; // STORE
  if (entry.compressionMethod === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    const out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
  }
  throw new Error(`Método de compresión ${entry.compressionMethod} no soportado (solo STORE/DEFLATE).`);
}

// ── CRC32 (tabla precalculada) — para el escritor ──────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32LE(view: DataView, off: number, v: number) { view.setUint32(off, v, true); }
function writeUint16LE(view: DataView, off: number, v: number) { view.setUint16(off, v, true); }

/** Arma un .zip STORE (sin comprimir) — simple, válido, sin dependencias. */
export function buildStoreZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const dosTime = 0, dosDate = 0b0000000000100001; // 1-ene (no importa para skills).

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    writeUint32LE(lv, 0, LFH_SIG);
    writeUint16LE(lv, 4, 20); // version needed
    writeUint16LE(lv, 6, 0); // flags
    writeUint16LE(lv, 8, 0); // method: store
    writeUint16LE(lv, 10, dosTime);
    writeUint16LE(lv, 12, dosDate);
    writeUint32LE(lv, 14, crc);
    writeUint32LE(lv, 18, f.data.length);
    writeUint32LE(lv, 22, f.data.length);
    writeUint16LE(lv, 26, nameBytes.length);
    writeUint16LE(lv, 28, 0);
    local.set(nameBytes, 30);

    chunks.push(local, f.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    writeUint32LE(cv, 0, CDH_SIG);
    writeUint16LE(cv, 4, 20);
    writeUint16LE(cv, 6, 20);
    writeUint16LE(cv, 8, 0);
    writeUint16LE(cv, 10, 0);
    writeUint16LE(cv, 12, dosTime);
    writeUint16LE(cv, 14, dosDate);
    writeUint32LE(cv, 16, crc);
    writeUint32LE(cv, 20, f.data.length);
    writeUint32LE(cv, 24, f.data.length);
    writeUint16LE(cv, 28, nameBytes.length);
    writeUint16LE(cv, 30, 0);
    writeUint16LE(cv, 32, 0);
    writeUint16LE(cv, 34, 0);
    writeUint16LE(cv, 36, 0);
    writeUint32LE(cv, 38, 0);
    writeUint32LE(cv, 42, offset);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.length + f.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  writeUint32LE(ev, 0, EOCD_SIG);
  writeUint16LE(ev, 4, 0);
  writeUint16LE(ev, 6, 0);
  writeUint16LE(ev, 8, files.length);
  writeUint16LE(ev, 10, files.length);
  writeUint32LE(ev, 12, centralSize);
  writeUint32LE(ev, 16, centralStart);
  writeUint16LE(ev, 20, 0);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  for (const c of centralChunks) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}
