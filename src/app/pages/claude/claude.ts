import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ClaudeSkillsService } from '../../../shared/services/claude-skills.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import {
  ClaudeSkill, ClaudePack, ClaudeProgreso, ClaudeEncuestaRespuesta, ClaudeOrgInfo, ClaudeSkillVersion,
} from '../../../shared/models/claude-skill.model';
import { ConfiguracionClaude } from '../configuracion/claude/configuracion-claude';
import { AdminClaude } from '../admin/claude/admin-claude';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

type Pestana = 'inicio' | 'skills' | 'crear' | 'auditoria';
type SubAuditoria = 'tecnica' | 'encuesta' | 'organizacion' | 'conexiones';

interface PlantillaSkill { id: string; label: string; pasos: string; ejemplo: string }

/** DO-10(f) — plantillas guiadas por tipo de skill: precargan Pasos/Ejemplo al
 *  elegirlas en Crear (editable, combinable con "Sugerir con IA"). */
const PLANTILLAS_SKILL: PlantillaSkill[] = [
  {
    id: 'correo-oficio', label: 'Correo/oficio formal',
    pasos: '1. Pide el motivo, el destinatario y los datos clave si faltan.\n2. Redacta en español dominicano de oficina, formal pero directo.\n3. Incluye saludo, cuerpo con el pedido/información, y despedida formal.',
    ejemplo: 'Usuario: "Escribe un oficio a la DGII pidiendo copia de un marbete perdido."\nRespuesta: oficio formal con membrete de la empresa, motivo, datos del vehículo y firma.',
  },
  {
    id: 'resumen-documento', label: 'Resumen de documento/acta',
    pasos: '1. Lee el documento o texto completo que pegue/adjunte la persona.\n2. Saca los puntos clave, decisiones tomadas y pendientes.\n3. Entrega el resumen en viñetas cortas, sin relleno.',
    ejemplo: 'Usuario: pega el acta de una reunión.\nRespuesta: "Decisiones: ... Pendientes: ... Responsables: ..."',
  },
  {
    id: 'checklist-tarea', label: 'Checklist de tarea',
    pasos: '1. Pregunta cuál es la tarea y qué pasos ya conoce la persona.\n2. Arma una lista de verificación ordenada, con casillas.\n3. Marca cuáles pasos son obligatorios y cuáles opcionales.',
    ejemplo: 'Usuario: "Dame el checklist para cerrar una obra."\nRespuesta: lista con [ ] inventario final, [ ] firma de recepción, [ ] fotos de cierre…',
  },
  {
    id: 'guia-paso-a-paso', label: 'Guía paso a paso',
    pasos: '1. Pregunta el objetivo final si no es obvio.\n2. Numera los pasos en orden, uno por línea, sin saltarte ninguno.\n3. Avisa si algún paso necesita algo del SGC (un módulo, un permiso) antes de poder hacerse.',
    ejemplo: 'Usuario: "¿Cómo registro un conduce externo?"\nRespuesta: "1. Ve a Inventario › Conduces. 2. ..."',
  },
];

/** DM2 — módulo Claude: biblioteca de skills por rol, Setup, creador guiado y
 *  auditoría (técnica + encuesta + organización + conexiones). Absorbe
 *  "Usar el SGC desde Claude" (Mi conexión, pestaña Inicio) y el panel admin de
 *  conexiones (Auditoría › Conexiones) por composición — ningún componente se borra. */
@Component({
  selector: 'app-claude',
  imports: [ConfiguracionClaude, AdminClaude, TranslatePipe, DatePipe],
  templateUrl: './claude.html',
  styleUrl: './claude.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClaudeModulo implements OnInit {
  private service = inject(ClaudeSkillsService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  pestana = signal<Pestana>('inicio');
  subAuditoria = signal<SubAuditoria>('tecnica');
  // DN-22 — estado real de conexión, reportado por <app-configuracion-claude>
  // embebido; deriva "Conecté el SGC a Claude" sin un checkbox deshabilitado.
  conectado = signal(false);
  filtroSkills = signal('');

  puedeAdministrar = computed(() => this.userService.puedeOperarSubmodulo('tecnologia.claude_administrar'));
  puedeAuditar = computed(() => this.userService.puedeVerSubmodulo('tecnologia.claude_auditoria'));
  misRoles = computed(() => this.userService.roles());

  skills = signal<ClaudeSkill[]>([]);
  packs = signal<ClaudePack[]>([]);
  progreso = signal<ClaudeProgreso | null>(null);
  cargando = signal(true);

  recomendadas = computed(() => {
    const roles = this.misRoles();
    return this.skills().filter((s) => s.estado === 'publicada' && s.roles.some((r) => roles.includes(r)));
  });
  resto = computed(() => {
    const recomendadasIds = new Set(this.recomendadas().map((s) => s.id));
    const filtro = this.filtroSkills().trim().toLowerCase();
    const tag = this.filtroTag();
    let base = this.skills().filter((s) => !recomendadasIds.has(s.id));
    if (tag) base = base.filter((s) => s.tags.includes(tag));
    if (!filtro) return base;
    return base.filter((s) => s.nombre.toLowerCase().includes(filtro) || s.descripcion?.toLowerCase().includes(filtro));
  });
  misPropuestasPendientes = computed(() => this.skills().filter((s) => s.estado === 'propuesta' || s.estado === 'requiere_revision'));

  // DO-10(g) — tags visibles y filtrables en la biblioteca.
  filtroTag = signal<string>('');
  tagsDisponibles = computed(() => {
    const set = new Set<string>();
    for (const s of this.skills()) for (const t of s.tags) set.add(t);
    return [...set].sort();
  });
  // DN-21 — "Descargar pack de mi rol" (Skills): primer pack tipo='rol' que
  // coincida con alguno de mis roles, si existe.
  packDeMiRol = computed(() => {
    const roles = this.misRoles();
    return this.packs().find((p) => p.tipo === 'rol' && p.rol && roles.includes(p.rol)) ?? null;
  });

  // ── Encuesta (DM-17) ────────────────────────────────────────────────────
  encuesta = signal<ClaudeEncuestaRespuesta | null>(null);
  encuestaUsaHoy = signal('');
  encuestaTareas = signal('');
  encuestaTareaRepetida = signal('');
  encuestaQueFrena = signal('');
  encuestaDocSemanal = signal('');
  encuestaQueDeberia = signal('');
  guardandoEncuesta = signal(false);
  resultadosEncuesta = signal<{ rol_snapshot: string | null; respuestas: number }[]>([]);

  // ── Organización (DM-15/18) ─────────────────────────────────────────────
  orgInfo = signal<ClaudeOrgInfo | null>(null);
  editandoOrg = signal(false);
  orgNotas = signal('');

  // ── Crear (DM-09) ───────────────────────────────────────────────────────
  crearQueHace = signal('');
  crearCuandoUsarla = signal('');
  crearPasos = signal('');
  crearEjemplo = signal('');
  crearSlug = signal('');
  guardandoCreacion = signal(false);

  // DO-10(f) — plantillas guiadas por tipo de skill.
  readonly plantillas = PLANTILLAS_SKILL;
  aplicarPlantilla(id: string) {
    const p = this.plantillas.find((x) => x.id === id);
    if (!p) return;
    this.crearPasos.set(p.pasos);
    this.crearEjemplo.set(p.ejemplo);
  }

  // DO-10(e) — "Sugerir con IA": borrador editable de Pasos/Ejemplo, consciente
  // del rol del usuario y las skills ya publicadas para ese rol.
  sugiriendoConIa = signal(false);
  async sugerirConIa() {
    if (this.sugiriendoConIa()) return;
    this.sugiriendoConIa.set(true);
    try {
      const { pasos, ejemplo } = await this.service.sugerirContenido(this.crearQueHace(), this.crearCuandoUsarla(), this.misRoles());
      this.crearPasos.set(pasos);
      this.crearEjemplo.set(ejemplo);
      this.toast.success('Borrador listo', 'Revísalo y edítalo antes de guardar.');
    } catch (e) {
      this.toast.error('No se pudo generar la sugerencia', e instanceof Error ? e.message : undefined);
    } finally {
      this.sugiriendoConIa.set(false);
    }
  }

  // DO-10(b) — proponer a mi equipo (ambito='equipo', pide el departamento).
  proponiendoEquipo = signal<ClaudeSkill | null>(null);
  equipoProponer = signal('');
  abrirProponerEquipo(s: ClaudeSkill) {
    this.equipoProponer.set('');
    this.proponiendoEquipo.set(s);
  }
  async confirmarProponerEquipo() {
    const s = this.proponiendoEquipo();
    const equipo = this.equipoProponer().trim();
    if (!s || !equipo) { this.toast.warning('Falta el equipo', 'Escribe el nombre del equipo/departamento.'); return; }
    try {
      await this.service.proponer(s.id, 'equipo', equipo);
      this.toast.success('Propuesta enviada', 'Tecnología la revisará para aprobarla.');
      this.proponiendoEquipo.set(null);
      await this.cargarTodo();
    } catch (e) {
      this.toast.error('No se pudo proponer', e instanceof Error ? e.message : undefined);
    }
  }

  // DO-10(c) — rating simple 👍/👎.
  async calificar(s: ClaudeSkill, valor: 'positivo' | 'negativo') {
    try {
      await this.service.calificar(s.id, valor);
      this.skills.update((xs) => xs.map((x) => x.id === s.id
        ? { ...x, rating_positivo: x.rating_positivo + (valor === 'positivo' ? 1 : 0), rating_negativo: x.rating_negativo + (valor === 'negativo' ? 1 : 0) }
        : x));
    } catch (e) {
      this.toast.error('No se pudo calificar', e instanceof Error ? e.message : undefined);
    }
  }

  // DO-10(h) — historial de versiones (pantalla simple de solo lectura).
  verHistorialDe = signal<ClaudeSkill | null>(null);
  versiones = signal<ClaudeSkillVersion[]>([]);
  cargandoVersiones = signal(false);
  async abrirHistorial(s: ClaudeSkill) {
    this.verHistorialDe.set(s);
    this.cargandoVersiones.set(true);
    try {
      this.versiones.set(await this.service.listarVersiones(s.id));
    } catch (e) {
      this.toast.error('No se pudo cargar el historial', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoVersiones.set(false);
    }
  }
  cerrarHistorial() {
    this.verHistorialDe.set(null);
    this.versiones.set([]);
  }

  crearPreview = computed(() => {
    const slug = this.crearSlug().trim() || 'mi-skill';
    const desc = this.crearCuandoUsarla().trim() || 'Describe cuándo usarla.';
    return `---\nname: ${slug}\ndescription: ${desc}\n---\n# Qué hace\n${this.crearQueHace() || '…'}\n\n# Pasos\n${this.crearPasos() || '…'}\n\n# Ejemplo\n${this.crearEjemplo() || '…'}\n`;
  });

  async ngOnInit() {
    const tabParam = this.route.snapshot.queryParamMap.get('tab') as Pestana | null;
    if (tabParam) this.pestana.set(tabParam);
    await this.cargarTodo();
  }

  async cargarTodo() {
    this.cargando.set(true);
    try {
      const [skills, packs, progreso] = await Promise.all([
        this.service.misSkills(), this.service.packs(), this.service.miProgreso(),
      ]);
      this.skills.set(skills);
      this.packs.set(packs);
      this.progreso.set(progreso);
    } catch (e) {
      this.toast.error('No se pudo cargar el módulo Claude', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPestana(p: Pestana) {
    this.pestana.set(p);
    void this.router.navigate([], { queryParams: { tab: p }, queryParamsHandling: 'merge' });
    if (p === 'auditoria' && this.subAuditoria() === 'encuesta') void this.cargarEncuesta();
    if (p === 'auditoria' && this.subAuditoria() === 'organizacion') void this.cargarOrg();
  }

  async cambiarSubAuditoria(s: SubAuditoria) {
    this.subAuditoria.set(s);
    if (s === 'encuesta') await this.cargarEncuesta();
    if (s === 'organizacion') await this.cargarOrg();
  }

  // DN-22 — "Conecté el SGC a Claude" se marca sola cuando la conexión real
  // existe (RPC claude_mi_conexion, vía el child embebido); nunca por un
  // checkbox deshabilitado que nadie puede marcar.
  onConectadoChange(conectado: boolean) {
    this.conectado.set(conectado);
    if (conectado && !this.progreso()?.conecto_sgc) void this.marcar('conecto_sgc');
  }

  async marcar(campo: 'conecto_sgc' | 'descargo_setup' | 'subio_primera_skill' | 'probo_pregunta') {
    try {
      await this.service.marcarProgreso(campo, true);
      this.progreso.update((p) => (p ? { ...p, [campo]: true } : p));
    } catch { /* no bloquea la pantalla */ }
  }

  async descargarSetup() {
    const pack = this.packs().find((p) => p.slug === 'setup-inicial');
    if (!pack) return;
    try {
      const blob = await this.service.descargarPack(pack.id);
      this.descargarBlob(blob, `${pack.slug}.zip`);
      await this.marcar('descargo_setup');
    } catch (e) {
      this.toast.error('No se pudo descargar el paquete', e instanceof Error ? e.message : undefined);
    }
  }

  async descargarPackDeMiRol() {
    const pack = this.packDeMiRol();
    if (!pack) return;
    try {
      const blob = await this.service.descargarPack(pack.id);
      this.descargarBlob(blob, `${pack.slug}.zip`);
    } catch (e) {
      this.toast.error('No se pudo descargar el paquete', e instanceof Error ? e.message : undefined);
    }
  }

  async descargarSkill(skill: ClaudeSkill) {
    try {
      const blob = await this.service.descargarSkill(skill.id);
      this.descargarBlob(blob, `${skill.slug}.zip`);
      // DO-10(c) — métrica simple de uso; no bloquea la descarga si falla.
      this.service.registrarDescarga(skill.id).then(
        () => this.skills.update((xs) => xs.map((x) => x.id === skill.id ? { ...x, descargas: x.descargas + 1 } : x)),
        () => { /* best-effort */ },
      );
    } catch (e) {
      this.toast.error('No se pudo descargar la skill', e instanceof Error ? e.message : undefined);
    }
  }

  private descargarBlob(blob: Blob, nombre: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  }

  async proponer(skill: ClaudeSkill, ambito: 'rol' | 'empresa') {
    try {
      await this.service.proponer(skill.id, ambito);
      this.toast.success('Propuesta enviada', 'Tecnología la revisará para aprobarla.');
      await this.cargarTodo();
    } catch (e) {
      this.toast.error('No se pudo proponer', e instanceof Error ? e.message : undefined);
    }
  }

  async decidir(skill: ClaudeSkill, decision: 'publicada' | 'borrador' | 'archivada') {
    try {
      await this.service.decidir(skill.id, decision);
      this.toast.success('Listo', `Skill marcada como ${decision}.`);
      await this.cargarTodo();
    } catch (e) {
      this.toast.error('No se pudo decidir', e instanceof Error ? e.message : undefined);
    }
  }

  async guardarCreacion() {
    const slug = this.crearSlug().trim();
    if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) {
      this.toast.error('Slug inválido', 'Usa minúsculas y guiones (ej. mi-skill-nueva).');
      return;
    }
    this.guardandoCreacion.set(true);
    try {
      const archivo = new File([this.crearPreview()], 'SKILL.md', { type: 'text/markdown' });
      const r = await this.service.validarYGuardar(archivo, slug, this.crearQueHace().slice(0, 60) || slug, this.crearCuandoUsarla());
      if (!r.ok) {
        this.toast.error('No se pudo guardar', r.errores.join(' '));
        return;
      }
      this.toast.success('Guardada', 'Tu skill quedó guardada como personal.');
      this.crearQueHace.set(''); this.crearCuandoUsarla.set(''); this.crearPasos.set(''); this.crearEjemplo.set(''); this.crearSlug.set('');
      await this.marcar('subio_primera_skill');
      await this.cargarTodo();
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoCreacion.set(false);
    }
  }

  async subirArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    const slug = archivo.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 64);
    try {
      const r = await this.service.validarYGuardar(archivo, slug, archivo.name, 'Subida manual.');
      if (!r.ok) { this.toast.error('No se pudo subir', r.errores.join(' ')); return; }
      this.toast.success('Subida', 'Tu archivo quedó guardado como skill personal.');
      await this.marcar('subio_primera_skill');
      await this.cargarTodo();
    } catch (e) {
      this.toast.error('No se pudo subir', e instanceof Error ? e.message : undefined);
    } finally {
      input.value = '';
    }
  }

  async cargarEncuesta() {
    const e = await this.service.miEncuesta().catch(() => null);
    this.encuesta.set(e);
    if (e) {
      this.encuestaUsaHoy.set(e.usa_hoy ?? ''); this.encuestaTareas.set(e.tareas ?? '');
      this.encuestaTareaRepetida.set(e.tarea_repetida ?? ''); this.encuestaQueFrena.set(e.que_frena ?? '');
      this.encuestaDocSemanal.set(e.documento_semanal ?? ''); this.encuestaQueDeberia.set(e.que_deberia_hacer ?? '');
    }
    if (this.puedeAuditar()) this.resultadosEncuesta.set(await this.service.resultadosEncuesta().catch(() => []));
  }

  async guardarEncuestaResp() {
    this.guardandoEncuesta.set(true);
    try {
      await this.service.guardarEncuesta({
        usa_hoy: this.encuestaUsaHoy(), tareas: this.encuestaTareas(), tarea_repetida: this.encuestaTareaRepetida(),
        que_frena: this.encuestaQueFrena(), documento_semanal: this.encuestaDocSemanal(), que_deberia_hacer: this.encuestaQueDeberia(),
      });
      this.toast.success('Gracias', 'Tu respuesta quedó guardada (puedes editarla cuando quieras).');
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoEncuesta.set(false);
    }
  }

  async cargarOrg() {
    const info = await this.service.orgInfo().catch(() => null);
    this.orgInfo.set(info);
    this.orgNotas.set(info?.notas ?? '');
  }

  async guardarOrg() {
    try {
      await this.service.guardarOrgInfo({ notas: this.orgNotas() });
      this.toast.success('Guardado', 'La sección de organización se actualizó.');
      this.editandoOrg.set(false);
      await this.cargarOrg();
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    }
  }
}
