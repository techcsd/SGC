// DG3 — el tablero "Hoy, en vivo" no debe mezclar actividad de HOY con conduces
// atrasados viejos (10 en_ruta de hace semanas != "sí hay movimiento hoy"), y las
// posiciones de flota viejas deben marcarse "sin señal" en vez de pintarse igual
// que una posición fresca.
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { TableroVivoComponent } from './tablero-vivo';
import {
  TableroVivoService, TableroVivo, ConduceAtrasado, UsoSinCerrar,
} from '../../../shared/services/tablero-vivo.service';
import { UserService } from '../../core/services/user.service';

const KPIS_VACIOS: TableroVivo['kpis'] = {
  requisiciones_hoy: 0, conduces_hoy: 0, entregas_hoy: 0, echadas_hoy: 0,
  vehiculos_en_uso: 0, usos_sin_cerrar: 0, bitacoras_hoy: 0,
};
const FLUJO_VACIO: TableroVivo['flujo'] = {
  solicitada: 0, aprobada: 0, despachada: 0, en_ruta: 0, atrasados: 0, entregada: 0,
};

function datosBase(overrides: Partial<TableroVivo> = {}): TableroVivo {
  return {
    eventos: [],
    flota: [],
    generado_en: new Date().toISOString(),
    ...overrides,
    kpis: { ...KPIS_VACIOS, ...overrides.kpis },
    flujo: { ...FLUJO_VACIO, ...overrides.flujo },
  };
}

function vehiculo(edadMin: number, overrides: Partial<TableroVivo['flota'][number]> = {}): TableroVivo['flota'][number] {
  return {
    vehiculo_id: 'v1', placa: 'A123456', alias: 'Camión 1', chofer: 'Juan',
    lat: 18.5, lng: -69.9, capturado_en: new Date().toISOString(), edad_min: edadMin,
    destino_lat: null, destino_lng: null, destino_texto: null, velocidad_estim_kmh: null,
    ...overrides,
  };
}

describe('TableroVivoComponent', () => {
  let atrasadosRespuesta: ConduceAtrasado[];
  let usosRespuesta: UsoSinCerrar[];

  beforeEach(() => {
    atrasadosRespuesta = [];
    usosRespuesta = [];

    const fakeService: Partial<TableroVivoService> = {
      resumen: async () => datosBase(),
      atrasadosDetalle: async () => atrasadosRespuesta,
      usosSinCerrarDetalle: async () => usosRespuesta,
      // ngOnDestroy (no se llama en estos tests, pero el fixture lo invoca al limpiar).
      desuscribir: async () => undefined,
    };
    const fakeUser: Partial<UserService> = {
      hasRole: () => true,
      hasModulo: () => true,
    };

    TestBed.configureTestingModule({
      imports: [TableroVivoComponent],
      providers: [
        { provide: TableroVivoService, useValue: fakeService },
        { provide: UserService, useValue: fakeUser },
      ],
    });
  });

  it('sin movimiento hoy + 10 atrasados: "sin movimiento" sigue siendo true y atrasados se ve aparte', () => {
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.datos.set(datosBase({ flujo: { solicitada: 0, aprobada: 0, despachada: 0, en_ruta: 0, atrasados: 10, entregada: 0 } }));

    // El mensaje "Todavía no hay movimiento hoy" se pinta cuando hayMovimiento() es false.
    expect(comp.hayMovimiento()).toBe(false);
    // Los 10 atrasados NO desaparecen: siguen visibles en d.flujo.atrasados, aparte.
    expect(comp.datos()!.flujo.atrasados).toBe(10);
  });

  it('con movimiento normal hoy: hayMovimiento() es true', () => {
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.datos.set(datosBase({ kpis: { requisiciones_hoy: 0, conduces_hoy: 3, entregas_hoy: 0, echadas_hoy: 0, vehiculos_en_uso: 0, usos_sin_cerrar: 0, bitacoras_hoy: 0 } }));
    expect(comp.hayMovimiento()).toBe(true);
  });

  it('con movimiento normal hoy Y conduces atrasados: ambos coexisten sin mezclarse', () => {
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.datos.set(datosBase({
      kpis: { requisiciones_hoy: 2, conduces_hoy: 0, entregas_hoy: 0, echadas_hoy: 0, vehiculos_en_uso: 0, usos_sin_cerrar: 0, bitacoras_hoy: 0 },
      flujo: { solicitada: 0, aprobada: 0, despachada: 0, en_ruta: 0, atrasados: 4, entregada: 0 },
    }));
    expect(comp.hayMovimiento()).toBe(true);
    expect(comp.datos()!.flujo.atrasados).toBe(4);
  });

  it('posición de hace más de 15 min se marca "sin señal" en el mapa', () => {
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.datos.set(datosBase({ flota: [vehiculo(20)] }));
    expect(comp.flotaSvg()[0].sinSenal).toBe(true);
  });

  it('posición reciente (<=15 min) NO se marca "sin señal"', () => {
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.datos.set(datosBase({ flota: [vehiculo(5)] }));
    expect(comp.flotaSvg()[0].sinSenal).toBe(false);
  });

  it('el backend ya filtra >12h: si llega un vehículo con edad_min alta igual se muestra (sin filtro extra en el cliente)', () => {
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.datos.set(datosBase({ flota: [vehiculo(700)] })); // >11h, el backend ya lo habría mandado o no
    expect(comp.flotaSvg().length).toBe(1);
    expect(comp.flotaSvg()[0].sinSenal).toBe(true);
  });

  it('toggleAtrasados abre y carga el detalle vía el servicio (uno a la vez con usos sin cerrar)', async () => {
    atrasadosRespuesta = [
      { referencia: 'CND-ABCDEFGH', obra: 'Obra Demo', vehiculo: 'ABC123', horas_en_transito: 60, transito_at: new Date().toISOString() },
    ];
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;
    comp.usosSinCerrarAbierto.set(true);

    await comp.toggleAtrasados();

    expect(comp.atrasadosAbierto()).toBe(true);
    expect(comp.atrasadosDetalle().length).toBe(1);
    expect(comp.atrasadosDetalle()[0].referencia).toBe('CND-ABCDEFGH');
    // Abrir atrasados cierra el otro panel (uno a la vez).
    expect(comp.usosSinCerrarAbierto()).toBe(false);

    await comp.toggleAtrasados();
    expect(comp.atrasadosAbierto()).toBe(false);
  });

  it('toggleUsosSinCerrar abre y carga el detalle de usos abiertos hace más de 24h', async () => {
    usosRespuesta = [
      { vehiculo_id: 'v1', vehiculo: 'Camión 1', chofer: 'Juan', horas_abierto: 30, inicio_at: new Date().toISOString() },
    ];
    const fixture = TestBed.createComponent(TableroVivoComponent);
    const comp = fixture.componentInstance;

    await comp.toggleUsosSinCerrar();

    expect(comp.usosSinCerrarAbierto()).toBe(true);
    expect(comp.usosSinCerrarDetalle().length).toBe(1);
    expect(comp.usosSinCerrarDetalle()[0].horas_abierto).toBe(30);
  });
});
