import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, viewChild } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { PlantillaDocumento, CampoPlantilla } from '../../../../shared/models/plantilla-documento.model';
import { EmpresaService, Empresa } from '../../../../shared/services/empresa.service';
import { construirValoresAuto } from '../../../../shared/utils/plantilla-merge.util';
import { UserService } from '../../../../app/core/services/user.service';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { PersonalCarnet } from './personal-carnet';
import {
  Cargo, PersonalObra, FOTOS_GUIA, FotoTipo,
  NACIONALIDADES, TIPOS_DOCUMENTO,
} from '../../../../shared/models/personal-obra.model';

/** AR1 — Wizard de registro de personal: datos → fotos guiadas → firma → carnet → resumen. */
@Component({
  selector: 'app-personal-registro',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, SignaturePad, PersonalCarnet],
  templateUrl: './personal-registro.html',
  styleUrl: './personal-registro.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalRegistro implements OnInit {
  private service = inject(PersonalObraService);
  private proyectos = inject(ProyectosService);
  private plantillasSvc = inject(PlantillasDocumentoService);
  private empresaSvc = inject(EmpresaService);
  private user = inject(UserService);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly fotosGuia = FOTOS_GUIA;
  readonly nacionalidades = NACIONALIDADES;
  readonly tiposDocumento = TIPOS_DOCUMENTO;
  readonly esAdmin = this.user.hasRole('admin');

  pad = viewChild(SignaturePad);
  carnet = viewChild(PersonalCarnet);

  paso = signal(1);
  readonly totalPasos = 5;

  obras = signal<ObraRef[]>([]);
  cargos = signal<Cargo[]>([]);
  plantillas = signal<PlantillaDocumento[]>([]);
  empresa = signal<Empresa | null>(null);
  personal = signal<PersonalObra | null>(null);
  editando = signal(false);

  // AZ1 — valores que el usuario completa en el paso Firma (los que el sistema no resuelve solo).
  valoresManual = signal<Record<string, string>>({});

  // fotos: tipo → preview url (blob local o firmado)
  fotoPreview = signal<Record<string, string>>({});
  subiendo = signal<string | null>(null);
  personaDataUrl = signal<string | null>(null);

  // firma
  plantillaSel = signal<string>('');
  documentoNombre = signal('Acuerdo de registro de personal de obra');
  firmaGuardada = signal(false);
  metodoFirma = signal<'pad' | 'foto'>('pad');

  saving = signal(false);
  error = signal('');

  form = this.fb.group({
    proyecto_id: ['', Validators.required],
    nombre: ['', Validators.required],
    apellido: [''],
    nacionalidad: ['dominicano', Validators.required],
    tipo_documento: ['cedula', Validators.required],
    documento_numero: [''],
    cargo_id: [''],
    telefono: [''],
    notas: [''],
  });

  get verifyUrl(): string {
    const p = this.personal();
    return p ? `${window.location.origin}/proyectos/personal/${p.id}` : '';
  }

  fotosCompletas = computed(() => {
    const prev = this.fotoPreview();
    return FOTOS_GUIA.every((g) => !!prev[g.tipo]);
  });

  async ngOnInit() {
    try {
      const [obras, cargos, plantillas, empresa] = await Promise.all([
        this.proyectos.getDirectorio(),
        this.service.getCargos(),
        this.plantillasSvc.getAll().catch(() => []),
        this.empresaSvc.get().catch(() => null),
      ]);
      this.obras.set(obras);
      this.cargos.set(cargos);
      this.plantillas.set(plantillas);
      this.empresa.set(empresa);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar los datos.');
    }
    const preObra = this.route.snapshot.queryParamMap.get('obra');
    if (preObra) this.form.patchValue({ proyecto_id: preObra });
    const editId = this.route.snapshot.queryParamMap.get('id');
    if (editId) await this.cargarEdicion(editId);
  }

  private async cargarEdicion(id: string) {
    const p = await this.service.getById(id);
    if (!p) return;
    this.editando.set(true);
    this.personal.set(p);
    this.form.patchValue({
      proyecto_id: p.proyecto_id, nombre: p.nombre, apellido: p.apellido ?? '',
      nacionalidad: p.nacionalidad, tipo_documento: p.tipo_documento,
      documento_numero: p.documento_numero ?? '', cargo_id: p.cargo_id ?? '',
      telefono: p.telefono ?? '', notas: p.notas ?? '',
    });
    const fotos = await this.service.getFotos(id);
    const prev: Record<string, string> = {};
    for (const f of fotos) prev[f.tipo] = await this.service.fotoUrl(f.foto_path);
    this.fotoPreview.set(prev);
    if (prev['persona']) this.personaDataUrl.set(await this.toDataUrl(prev['persona']));
  }

  // ── Paso 1: datos → crea/actualiza y avanza ────────────────────────────────
  async guardarDatos() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    this.error.set('');
    try {
      const v = this.form.getRawValue();
      const payload: Partial<PersonalObra> = {
        proyecto_id: v.proyecto_id!, nombre: v.nombre!.trim(), apellido: v.apellido?.trim() || null,
        nacionalidad: v.nacionalidad as PersonalObra['nacionalidad'],
        tipo_documento: v.tipo_documento as PersonalObra['tipo_documento'],
        documento_numero: v.documento_numero?.trim() || null,
        cargo_id: v.cargo_id || null, telefono: v.telefono?.trim() || null, notas: v.notas?.trim() || null,
      };
      const actual = this.personal();
      const saved = actual ? await this.service.actualizar(actual.id, payload) : await this.service.crear(payload);
      this.personal.set(saved);
      this.paso.set(2);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron guardar los datos.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Paso 2: fotos guiadas ──────────────────────────────────────────────────
  async onFoto(tipo: FotoTipo, ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const p = this.personal();
    if (!p) return;
    this.subiendo.set(tipo);
    this.error.set('');
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      await this.service.subirFoto(p, tipo, file, ext);
      const localUrl = URL.createObjectURL(file);
      this.fotoPreview.update((m) => ({ ...m, [tipo]: localUrl }));
      if (tipo === 'persona') this.personaDataUrl.set(await this.toDataUrl(localUrl));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo subir la foto.');
    } finally {
      this.subiendo.set(null);
      input.value = '';
    }
  }

  // ── Paso 3: firma del documento (AZ1 — merge de variables) ──────────────────
  onPlantilla(id: string) {
    this.plantillaSel.set(id);
    this.valoresManual.set({}); // reinicia los campos pedidos al cambiar de plantilla
    const pl = this.plantillas().find((x) => x.id === id);
    if (pl) this.documentoNombre.set(pl.nombre);
  }

  /** Plantilla seleccionada (o null para el acuerdo por defecto). */
  plantillaActual = computed(() => this.plantillas().find((x) => x.id === this.plantillaSel()) ?? null);

  /** AZ1 — valores que el sistema resuelve solo (empresa, empleado, obra, fecha). */
  valoresAuto = computed<Record<string, string>>(() => {
    const p = this.personal();
    if (!p) return {};
    const cargo = this.cargos().find((c) => c.id === p.cargo_id)?.nombre ?? null;
    const obra = this.obras().find((o) => o.id === p.proyecto_id)?.nombre ?? p.proyecto?.nombre ?? null;
    return construirValoresAuto({
      empresa: this.empresa(),
      persona: { nombre: p.nombre, apellido: p.apellido, documento_numero: p.documento_numero, cargo, telefono: p.telefono },
      obra: { nombre: obra },
      hoyIso: new Date().toISOString().slice(0, 10),
    });
  });

  /** Todos los valores (auto + los pedidos manualmente). */
  valores = computed<Record<string, string>>(() => ({ ...this.valoresAuto(), ...this.valoresManual() }));

  /** Campos de la plantilla que el sistema NO resolvió solo → se piden en el paso Firma. */
  camposPendientes = computed<CampoPlantilla[]>(() => {
    const pl = this.plantillaActual();
    if (!pl) return [];
    const auto = this.valoresAuto();
    return (pl.campos ?? []).filter((c) => !(auto[c.key] ?? '').trim());
  });

  /** ¿Quedan campos requeridos sin completar? (bloquea la firma — AZ1 d) */
  faltanCampos = computed(() => {
    const vals = this.valores();
    return this.camposPendientes().some((c) => !(vals[c.key] ?? '').trim());
  });

  /** Vista previa con las variables YA resueltas (nada de {{placeholders}} crudos). */
  plantillaHtml = computed(() => {
    const pl = this.plantillaActual();
    if (!pl) return '';
    return this.plantillasSvc.renderizar(pl.contenido_html, this.valores(), pl.campos ?? []);
  });

  setCampo(key: string, value: string) {
    this.valoresManual.update((m) => ({ ...m, [key]: value }));
  }

  async guardarFirma() {
    const p = this.personal();
    if (!p) return;
    // AZ1 (d) — nadie firma un contrato con variables sin resolver.
    if (this.plantillaActual() && this.faltanCampos()) {
      this.error.set('Completa los campos pendientes del documento antes de firmar.');
      return;
    }
    const pad = this.pad();
    if (!pad || pad.isEmpty()) { this.error.set('Dibuja la firma antes de continuar.'); return; }
    const blob = await pad.toBlob();
    if (!blob) { this.error.set('No se pudo capturar la firma.'); return; }
    this.saving.set(true);
    this.error.set('');
    try {
      const pl = this.plantillaActual();
      await this.service.registrarFirma(p, this.documentoNombre().trim() || 'Documento', blob, {
        plantillaId: this.plantillaSel() || null,
        metodo: 'pad',
        // AZ1 (c) — snapshot: congela valores + HTML final resuelto al momento de firmar.
        valores: pl ? this.valores() : undefined,
        documentoHtml: pl ? this.plantillaHtml() : undefined,
      });
      this.firmaGuardada.set(true);
      this.paso.set(4);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo guardar la firma.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Paso 4: emitir carnet ──────────────────────────────────────────────────
  async emitirCarnet() {
    const p = this.personal();
    if (!p) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const num = await this.service.emitirCarnet(p.id);
      this.personal.set({ ...p, carnet_numero: num, carnet_emitido_at: new Date().toISOString() });
      this.paso.set(5);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo emitir el carnet.');
    } finally {
      this.saving.set(false);
    }
  }

  imprimirCarnet() { void this.carnet()?.imprimir(); }

  private async toDataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((r) => {
        const fr = new FileReader();
        fr.onloadend = () => r(typeof fr.result === 'string' ? fr.result : null);
        fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  irPaso(n: number) { if (n >= 1 && n <= this.totalPasos && this.personal()) this.paso.set(n); }
  saltarFirma() { this.paso.set(4); }
  finalizar() {
    const p = this.personal();
    this.router.navigate(p ? ['/proyectos/personal', p.id] : ['/proyectos/personal']);
  }
}
