import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ClaudeSkillsService } from '../../../shared/services/claude-skills.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ClaudeSkill, ClaudePack, ClaudeProgreso, ClaudeEncuestaRespuesta, ClaudeOrgInfo } from '../../../shared/models/claude-skill.model';
import { ConfiguracionClaude } from '../configuracion/claude/configuracion-claude';
import { AdminClaude } from '../admin/claude/admin-claude';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

type Pestana = 'inicio' | 'skills' | 'crear' | 'auditoria';
type SubAuditoria = 'tecnica' | 'encuesta' | 'organizacion' | 'conexiones';

/** DM2 — módulo Claude: biblioteca de skills por rol, Setup, creador guiado y
 *  auditoría (técnica + encuesta + organización + conexiones). Absorbe
 *  "Usar el SGC desde Claude" (Mi conexión, pestaña Inicio) y el panel admin de
 *  conexiones (Auditoría › Conexiones) por composición — ningún componente se borra. */
@Component({
  selector: 'app-claude',
  imports: [ConfiguracionClaude, AdminClaude, TranslatePipe],
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
    return this.skills().filter((s) => !recomendadasIds.has(s.id));
  });
  misPropuestasPendientes = computed(() => this.skills().filter((s) => s.estado === 'propuesta' || s.estado === 'requiere_revision'));

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

  async descargarSkill(skill: ClaudeSkill) {
    try {
      const blob = await this.service.descargarSkill(skill.id);
      this.descargarBlob(blob, `${skill.slug}.zip`);
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
