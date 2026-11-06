import { describe, it, expect } from 'vitest';
import { parsearChatWhatsapp } from './wa-chat-import.util';

describe('wa-chat-import.util', () => {
  it('Android, 24h, fecha dominicana (día/mes/año) → 2 mensajes, autor y texto correctos', () => {
    const txt = [
      '5/3/24, 9:05 - Juan Pérez: Buenos días, ¿cómo va lo de la obra?',
      '5/3/24, 9:06 - María Gómez: Vamos bien, llegamos a las 7',
    ].join('\n');
    const r = parsearChatWhatsapp(txt);
    expect(r.formatoDetectado).toBe('android');
    expect(r.mensajes).toHaveLength(2);
    expect(r.mensajes[0]).toMatchObject({
      autorNombre: 'Juan Pérez',
      texto: 'Buenos días, ¿cómo va lo de la obra?',
      tipo: 'texto',
    });
    expect(r.mensajes[0].enviadoEn).toBe('2024-03-05T09:05:00-04:00');
    expect(r.mensajes[1].autorNombre).toBe('María Gómez');
  });

  it('Android, 12h con a. m./p. m. → hora convertida a 24h correctamente', () => {
    const txt = [
      '12/4/23, 10:15 a. m. - Juan Pérez: Hola de la mañana',
      '12/4/23, 3:40 p. m. - Juan Pérez: Hola de la tarde',
      '12/4/23, 12:00 a. m. - Juan Pérez: Medianoche',
      '12/4/23, 12:00 p. m. - Juan Pérez: Mediodía',
    ].join('\n');
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes.map((m) => m.enviadoEn)).toEqual([
      '2023-04-12T10:15:00-04:00',
      '2023-04-12T15:40:00-04:00',
      '2023-04-12T00:00:00-04:00',
      '2023-04-12T12:00:00-04:00',
    ]);
  });

  it('iPhone, formato con corchetes y segundos → se detecta como iphone', () => {
    const txt = '[5/3/24, 9:05:03 a. m.] Juan Pérez: Hola desde iPhone';
    const r = parsearChatWhatsapp(txt);
    expect(r.formatoDetectado).toBe('iphone');
    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0].enviadoEn).toBe('2024-03-05T09:05:03-04:00');
  });

  it('mensaje multilínea se concatena al mensaje anterior, no se pierde ni se separa', () => {
    const txt = [
      '5/3/24, 9:05 - Juan Pérez: Lista de materiales:',
      '- Cemento 50 sacos',
      '- Arena 2 camiones',
    ].join('\n');
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0].texto).toBe('Lista de materiales:\n- Cemento 50 sacos\n- Arena 2 camiones');
  });

  it('líneas de sistema (cifrado, entradas/salidas) se ignoran, no se inventan como mensajes', () => {
    const txt = [
      '5/3/24, 9:00 - Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos.',
      '5/3/24, 9:01 - Juan Pérez se unió usando el enlace de invitación del grupo',
      '5/3/24, 9:05 - Juan Pérez: Hola a todos',
    ].join('\n');
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0].texto).toBe('Hola a todos');
    expect(r.lineasIgnoradas).toBe(2);
  });

  it('placeholder de multimedia (español e inglés) se guarda con tipo "otro", nunca se inventa contenido', () => {
    const txt = [
      '5/3/24, 9:05 - Juan Pérez: <Multimedia omitido>',
      '5/3/24, 9:06 - Juan Pérez: imagen omitida',
      '5/3/24, 9:07 - Juan Pérez: <audio omitted>',
    ].join('\n');
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes).toHaveLength(3);
    expect(r.mensajes.every((m) => m.tipo === 'otro')).toBe(true);
  });

  it('participante sin contacto guardado (aparece como número) → autorTelefono se extrae', () => {
    const txt = '5/3/24, 9:05 - +1 849 123 4567: Hola, soy nuevo en el grupo';
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes[0].autorTelefono).toBe('18491234567');
  });

  it('un contacto guardado (nombre normal) no se confunde con un teléfono', () => {
    const txt = '5/3/24, 9:05 - Juan Pérez: Hola';
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes[0].autorTelefono).toBeNull();
  });

  it('idempotencia: el mismo contenido produce el mismo idImport (reimportar no duplica)', () => {
    const txt = '5/3/24, 9:05 - Juan Pérez: Hola a todos';
    const r1 = parsearChatWhatsapp(txt);
    const r2 = parsearChatWhatsapp(txt);
    expect(r1.mensajes[0].idImport).toBe(r2.mensajes[0].idImport);
    expect(r1.mensajes[0].idImport).toMatch(/^import:[0-9a-f]+$/);
  });

  it('dos mensajes distintos producen idImport distintos', () => {
    const txt = ['5/3/24, 9:05 - Juan Pérez: Hola a todos', '5/3/24, 9:06 - Juan Pérez: Hola de nuevo'].join('\n');
    const r = parsearChatWhatsapp(txt);
    expect(r.mensajes[0].idImport).not.toBe(r.mensajes[1].idImport);
  });

  it('contenido vacío o solo líneas en blanco → sin mensajes, sin reventar', () => {
    expect(parsearChatWhatsapp('').mensajes).toHaveLength(0);
    expect(parsearChatWhatsapp('\n\n   \n').mensajes).toHaveLength(0);
  });
});
