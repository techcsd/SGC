// DN-22/DN-21 (ronda DN) — "Conecté el SGC a Claude" se deriva del estado
// real de conexión (no un checkbox deshabilitado que nadie marca) + buscador
// de Skills + "pack de mi rol".
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { ClaudeModulo } from './claude';
import { ClaudeSkillsService } from '../../../shared/services/claude-skills.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ClaudePack, ClaudeProgreso, ClaudeSkill } from '../../../shared/models/claude-skill.model';

function fakeSupabase() {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }) };
  return { client: { from: () => chain, rpc: async () => ({ data: null }) } } as unknown as SupabaseService;
}

function skill(overrides: Partial<ClaudeSkill> = {}): ClaudeSkill {
  return {
    id: 's1', slug: 'slug-1', nombre: 'Skill 1', descripcion: 'hace cosas de obra',
    tipo: 'skill', ambito: 'personal', estado: 'publicada', roles: [], tags: [],
    owner_id: 'u1', version_actual: 1, tiene_codigo_ejecutable: false, motivo_devuelta: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    equipo: null, descargas: 0, rating_positivo: 0, rating_negativo: 0,
    ...overrides,
  };
}

function progresoVacio(overrides: Partial<ClaudeProgreso> = {}): ClaudeProgreso {
  return {
    usuario_id: 'u1', conecto_sgc: false, descargo_setup: false,
    subio_primera_skill: false, probo_pregunta: false,
    ...overrides,
  } as ClaudeProgreso;
}

describe('ClaudeModulo', () => {
  let marcados: string[];
  let propuestas: Array<{ id: string; ambito: string; equipo?: string }>;
  let calificaciones: Array<{ id: string; valor: string }>;
  let descargasRegistradas: string[];
  let versionesPedidas: string[];
  let sugerenciasPedidas: Array<{ queHace: string; cuandoUsarla: string; roles: string[] }>;

  beforeEach(() => {
    marcados = [];
    propuestas = [];
    calificaciones = [];
    descargasRegistradas = [];
    versionesPedidas = [];
    sugerenciasPedidas = [];
    const fakeService: Partial<ClaudeSkillsService> = {
      misSkills: async () => [
        skill({ id: 's1', nombre: 'Requisiciones rápidas', descripcion: 'arma una requisición', tags: ['inventario'] }),
        skill({ id: 's2', nombre: 'Reporte de flota', descripcion: 'resume el estado de vehículos', tags: ['flota'] }),
      ],
      packs: async () => [
        { id: 'p1', slug: 'pack-ingeniero', nombre: 'Pack Ingeniero', descripcion: 'skills de ingeniería', tipo: 'rol', rol: 'ingeniero_campo' } as ClaudePack,
      ],
      miProgreso: async () => progresoVacio(),
      marcarProgreso: async (campo: string) => { marcados.push(campo); },
      descargarSkill: async () => new Blob(['x']),
      proponer: async (id: string, ambito: 'rol' | 'empresa' | 'equipo', equipo?: string) => { propuestas.push({ id, ambito, equipo }); },
      calificar: async (id: string, valor: 'positivo' | 'negativo') => { calificaciones.push({ id, valor }); },
      registrarDescarga: async (id: string) => { descargasRegistradas.push(id); },
      listarVersiones: async (id: string) => { versionesPedidas.push(id); return []; },
      sugerirContenido: async (queHace: string, cuandoUsarla: string, roles: string[]) => {
        sugerenciasPedidas.push({ queHace, cuandoUsarla, roles });
        return { pasos: 'Paso sugerido', ejemplo: 'Ejemplo sugerido' };
      },
    };
    const fakeUser: Partial<UserService> = {
      puedeOperarSubmodulo: () => false,
      puedeVerSubmodulo: () => false,
      roles: signal(['ingeniero_campo']),
    };

    TestBed.configureTestingModule({
      imports: [ClaudeModulo],
      providers: [
        { provide: ClaudeSkillsService, useValue: fakeService },
        { provide: UserService, useValue: fakeUser },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: Router, useValue: { navigate: async () => true } },
        { provide: SupabaseService, useValue: fakeSupabase() },
      ],
    });
  });

  it('DO-09: "Conecté el SGC a Claude" pendiente enlaza por ancla real a la tarjeta Mi conexión', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    fixture.detectChanges(); // dispara ngOnInit (fire-and-forget en zoneless)
    await comp.cargarTodo(); // espera una carga determinística antes de leer el DOM
    fixture.detectChanges();

    const anchor = fixture.nativeElement.querySelector('a[href="#mi-conexion"]');
    expect(anchor).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#mi-conexion')).toBeTruthy();
  });

  it('DN-22: conexión real (true) marca conecto_sgc sola, sin que nadie toque un checkbox', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    expect(comp.progreso()?.conecto_sgc).toBe(false);
    comp.onConectadoChange(true);
    await Promise.resolve();

    expect(marcados).toContain('conecto_sgc');
    expect(comp.progreso()?.conecto_sgc).toBe(true);
  });

  it('DN-22: sin conexión no marca nada (queda "pendiente")', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    comp.onConectadoChange(false);
    expect(marcados).not.toContain('conecto_sgc');
    expect(comp.progreso()?.conecto_sgc).toBe(false);
  });

  it('DN-22: ya marcado no se re-marca en cada cambio de conexión (idempotente)', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();
    comp.progreso.set(progresoVacio({ conecto_sgc: true }));

    comp.onConectadoChange(true);
    expect(marcados).not.toContain('conecto_sgc');
  });

  it('DN-21: el buscador de Skills filtra la biblioteca por nombre/descripción', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    expect(comp.resto().length).toBe(2);
    comp.filtroSkills.set('flota');
    expect(comp.resto().map((s) => s.id)).toEqual(['s2']);
    comp.filtroSkills.set('');
    expect(comp.resto().length).toBe(2);
  });

  it('DN-21: "pack de mi rol" encuentra el pack tipo=rol que coincide con mis roles', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    expect(comp.packDeMiRol()?.slug).toBe('pack-ingeniero');
  });

  it('DO-10(f): aplicarPlantilla precarga Pasos/Ejemplo (editable después)', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    comp.aplicarPlantilla('checklist-tarea');
    expect(comp.crearPasos()).toContain('verificación');
    expect(comp.crearEjemplo().length).toBeGreaterThan(0);
  });

  it('DO-10(e): sugerirConIa pasa el rol del usuario y precarga el borrador devuelto', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();
    comp.crearQueHace.set('Resumir reportes');
    comp.crearCuandoUsarla.set('Al cerrar el día');

    await comp.sugerirConIa();

    expect(sugerenciasPedidas).toEqual([{ queHace: 'Resumir reportes', cuandoUsarla: 'Al cerrar el día', roles: ['ingeniero_campo'] }]);
    expect(comp.crearPasos()).toBe('Paso sugerido');
    expect(comp.crearEjemplo()).toBe('Ejemplo sugerido');
  });

  it('DO-10(g): filtroTag filtra la biblioteca por tag', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    expect(comp.tagsDisponibles()).toEqual(['flota', 'inventario']);
    comp.filtroTag.set('flota');
    expect(comp.resto().map((s) => s.id)).toEqual(['s2']);
  });

  it('DO-10(b): abrirProponerEquipo + confirmarProponerEquipo propone con ambito=equipo y el nombre escrito', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    comp.abrirProponerEquipo(skill({ id: 's1' }));
    comp.equipoProponer.set('RRHH');
    await comp.confirmarProponerEquipo();

    expect(propuestas).toEqual([{ id: 's1', ambito: 'equipo', equipo: 'RRHH' }]);
  });

  it('DO-10(b): confirmarProponerEquipo sin nombre de equipo no propone nada', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    comp.abrirProponerEquipo(skill({ id: 's1' }));
    comp.equipoProponer.set('   ');
    await comp.confirmarProponerEquipo();

    expect(propuestas).toEqual([]);
  });

  it('DO-10(c): calificar registra el voto y actualiza el contador local', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    await comp.calificar(comp.skills()[0], 'positivo');

    expect(calificaciones).toEqual([{ id: 's1', valor: 'positivo' }]);
    expect(comp.skills().find((s) => s.id === 's1')?.rating_positivo).toBe(1);
  });

  it('DO-10(h): abrirHistorial pide las versiones de esa skill', async () => {
    const fixture = TestBed.createComponent(ClaudeModulo);
    const comp = fixture.componentInstance;
    await comp.cargarTodo();

    await comp.abrirHistorial(comp.skills()[0]);

    expect(versionesPedidas).toEqual(['s1']);
    expect(comp.verHistorialDe()?.id).toBe('s1');
  });

  it('DO-10(c): descargarSkill también registra la descarga', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    try {
      const fixture = TestBed.createComponent(ClaudeModulo);
      const comp = fixture.componentInstance;
      await comp.cargarTodo();

      await comp.descargarSkill(comp.skills()[0]);
      await Promise.resolve(); // el registro de descarga es fire-and-forget

      expect(descargasRegistradas).toEqual(['s1']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
