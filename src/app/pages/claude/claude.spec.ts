// DN-22/DN-21 (ronda DN) — "Conecté el SGC a Claude" se deriva del estado
// real de conexión (no un checkbox deshabilitado que nadie marca) + buscador
// de Skills + "pack de mi rol".
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { ClaudeModulo } from './claude';
import { ClaudeSkillsService } from '../../../shared/services/claude-skills.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ClaudePack, ClaudeProgreso, ClaudeSkill } from '../../../shared/models/claude-skill.model';

function skill(overrides: Partial<ClaudeSkill> = {}): ClaudeSkill {
  return {
    id: 's1', slug: 'slug-1', nombre: 'Skill 1', descripcion: 'hace cosas de obra',
    tipo: 'skill', ambito: 'personal', estado: 'publicada', roles: [], tags: [],
    owner_id: 'u1', version_actual: 1, tiene_codigo_ejecutable: false, motivo_devuelta: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
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

  beforeEach(() => {
    marcados = [];
    const fakeService: Partial<ClaudeSkillsService> = {
      misSkills: async () => [
        skill({ id: 's1', nombre: 'Requisiciones rápidas', descripcion: 'arma una requisición' }),
        skill({ id: 's2', nombre: 'Reporte de flota', descripcion: 'resume el estado de vehículos' }),
      ],
      packs: async () => [
        { id: 'p1', slug: 'pack-ingeniero', nombre: 'Pack Ingeniero', descripcion: 'skills de ingeniería', tipo: 'rol', rol: 'ingeniero_campo' } as ClaudePack,
      ],
      miProgreso: async () => progresoVacio(),
      marcarProgreso: async (campo: string) => { marcados.push(campo); },
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
        { provide: ToastService, useValue: { error: () => {}, success: () => {} } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: Router, useValue: { navigate: async () => true } },
      ],
    });
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
});
