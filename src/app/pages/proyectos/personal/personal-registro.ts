import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { MotionService } from '../../../../shared/services/motion.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { PlantillaDocumento, CampoPlantilla } from '../../../../shared/models/plantilla-documento.model';
import { EmpresaService, Empresa } from '../../../../shared/services/empresa.service';
import { construirValoresAuto } from '../../../../shared/utils/plantilla-merge.util';
import { UserService } from '../../../../app/core/services/user.service';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { PersonalCarnet } from './personal-carnet';
import { Icon } from '../../../../shared/ui/icon/icon';
import {
  Cargo, PersonalObra, FOTOS_GUIA, FotoTipo,
  NACIONALIDADES, TIPOS_DOCUMENTO, NACIONALIDAD_LABEL,
} from '../../../../shared/models/personal-obra.model';

/** AR1 — Wizard de registro de personal: datos → fotos guiadas → firma → carnet → resumen. */
@Component({
  selector: 'app-personal-registro',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, SignaturePad, PersonalCarnet, Icon],
  templateUrl: './personal-registro.html',
  styleUrl: './personal-registro.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalRegistro implements OnInit {
  private service = inject(PersonalObraService);
  private motion = inject(MotionService);
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
  // CE16 — aviso de posible duplicado por documento al registrar uno nuevo.
  dupAviso = signal<string[]>([]);
  dupConfirmado = signal(false);
  readonly totalPasos = 5;

  // ── DB5 — Registro rápido (2 fotos): paso 0 con documento + persona-con-documento.
  rapido = signal(false);
  fotoDocFile = signal<File | null>(null);
  fotoPersonaFile = signal<File | null>(null);
  fotoDocPreview = signal<string | null>(null);
  fotoPersonaPreview = signal<string | null>(null);
  leyendoIa = signal(false);
  /** veredicto cara↔documento de la IA ('si'|'no'|'dudoso') — solo aviso, nunca bloquea. */
  coincideRostro = signal<'si' | 'no' | 'dudoso' | null>(null);
  // CE16+DB5 — duplicados con id, para ofrecer «marcar presente hoy» en vez de duplicar.
  dupRegistros = signal<{ id: string; nombre: string; proyecto: string | null }[]>([]);

  obras = signal<ObraRef[]>([]);
  // BO6 (§E-5) — ids de obras de prueba, para avisar (no bloquear) al registrar
  // personal REAL en una obra de prueba: heredaría es_prueba por trigger y quedaría
  // oculto de la lista real (así se "perdió" Papolo).
  esPruebaIds = signal<Set<string>>(new Set());

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
    domicilio: [''],            // CF7 — para el contrato
    tarifa_hora: [null as number | null], // CF7 — salario por hora
    notas: [''],
  });

  // BO6 (§E-5) — la obra seleccionada es de prueba (declarado tras `form` por el
  // orden de inicialización de campos: toSignal necesita el control ya creado).
  private proyectoIdSig = toSignal(this.form.controls.proyecto_id.valueChanges, {
    initialValue: this.form.controls.proyecto_id.value,
  });
  obraEsPrueba = computed(() => this.esPruebaIds().has(this.proyectoIdSig() ?? ''));

  get verifyUrl(): string {
    const p = this.personal();
    // CE5 — el QR del carnet apunta a la verificación pública por número de carnet.
    return p?.carnet_numero ? `${window.location.origin}/verificar/${p.carnet_numero}` : '';
  }

  fotosCompletas = computed(() => {
    const prev = this.fotoPreview();
    return FOTOS_GUIA.every((g) => !!prev[g.tipo]);
  });

  async ngOnInit() {
    try {
      const [obras, cargos, plantillas, empresa] = await Promise.all([
        this.proyectos.getDirectorio('personal'),
        this.service.getCargos(),
        this.plantillasSvc.getAll().catch(() => []),
        this.empresaSvc.get().catch(() => null),
      ]);
      this.obras.set(obras);
      this.cargos.set(cargos);
      this.plantillas.set(plantillas);
      this.empresa.set(empresa);
      // BO6 (§E-5) — obras de prueba (para el aviso). Best-effort, no bloquea el alta.
      this.proyectos.getObrasPruebaIds().then((ids) => this.esPruebaIds.set(new Set(ids)));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar los datos.');
    }
    const preObra = this.route.snapshot.queryParamMap.get('obra');
    if (preObra) this.form.patchValue({ proyecto_id: preObra });
    const editId = this.route.snapshot.queryParamMap.get('id');
    if (editId) await this.cargarEdicion(editId);
    // DB5 — modo «Registro rápido (2 fotos)»: paso 0 antes de los datos.
    if (!editId && this.route.snapshot.queryParamMap.get('rapido')) {
      this.rapido.set(true);
      this.paso.set(0);
    }
  }

  // ── DB5 — paso 0: dos fotos → la IA precarga los campos ─────────────────────
  onFotoRapida(cual: 'documento' | 'persona', ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (cual === 'documento') { this.fotoDocFile.set(file); this.fotoDocPreview.set(url); }
    else { this.fotoPersonaFile.set(file); this.fotoPersonaPreview.set(url); }
    input.value = '';
  }

  async leerConIa() {
    const doc = this.fotoDocFile();
    const per = this.fotoPersonaFile();
    if (!doc || !per || this.leyendoIa()) return;
    this.leyendoIa.set(true);
    this.error.set('');
    try {
      const [b1, b2] = await Promise.all([this.fileABase64(doc), this.fileABase64(per)]);
      const lectura = await this.service.leerDocumento(
        { data: b1, mime: doc.type || 'image/jpeg' },
        { data: b2, mime: per.type || 'image/jpeg' },
      );
      // Precarga EDITABLE (nada se guarda solo). 'venezolano' no está en el
      // catálogo de nacionalidades del alta → cae a 'otro' y queda en notas.
      const nacionalidad = lectura.nacionalidad === 'venezolano' ? 'otro' : (lectura.nacionalidad ?? 'dominicano');
      this.form.patchValue({
        nombre: lectura.nombre ?? '',
        apellido: lectura.apellido ?? '',
        tipo_documento: lectura.tipo_documento ?? 'cedula',
        documento_numero: lectura.documento_numero ?? '',
        nacionalidad,
        notas: lectura.nacionalidad === 'venezolano' ? 'Nacionalidad leída: venezolano' : this.form.controls.notas.value,
      });
      this.coincideRostro.set(lectura.coincide_rostro);
      this.paso.set(1);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo leer el documento.');
    } finally {
      this.leyendoIa.set(false);
    }
  }

  saltarLectura() { this.paso.set(1); }

  /** DB5 — el duplicado detectado ya trabaja aquí: márcalo presente hoy y listo. */
  async marcarPresenteHoy(personalId: string) {
    this.saving.set(true);
    this.error.set('');
    try {
      await this.service.levantamientoMarcar(personalId, true);
      this.router.navigate(['/proyectos/personal'], { queryParams: { presente: '1' } });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo marcar presente.');
    } finally {
      this.saving.set(false);
    }
  }

  /** DB5 — tras crear en modo rápido, las 2 fotos se guardan como las tipadas de siempre. */
  private async subirFotosRapidas(p: PersonalObra) {
    const pares: [FotoTipo, File | null][] = [
      ['documento', this.fotoDocFile()],
      ['persona_carnet_cedula', this.fotoPersonaFile()],
    ];
    for (const [tipo, file] of pares) {
      if (!file) continue;
      try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        await this.service.subirFoto(p, tipo, file, ext);
        this.fotoPreview.update((m) => ({ ...m, [tipo]: URL.createObjectURL(file) }));
      } catch { /* la foto se puede resubir en el paso 2 */ }
    }
  }

  private fileABase64(f: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] ?? '');
      r.onerror = () => rej(new Error('No se pudo leer la foto.'));
      r.readAsDataURL(f);
    });
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
      telefono: p.telefono ?? '', domicilio: p.domicilio ?? '', tarifa_hora: p.tarifa_hora ?? null,
      notas: p.notas ?? '',
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
        domicilio: v.domicilio?.trim() || null,
        tarifa_hora: v.tarifa_hora != null && Number.isFinite(Number(v.tarifa_hora)) ? Number(v.tarifa_hora) : null,
      };
      const actual = this.personal();
      // CE16 — al registrar uno NUEVO: avisa si ya existe otro con el mismo documento.
      if (!actual && !this.dupConfirmado() && payload.documento_numero) {
        const existentes = await this.service.docExiste(payload.tipo_documento!, payload.documento_numero, undefined);
        if (existentes.length > 0) {
          this.dupAviso.set(existentes.map((e) => `${e.nombre} (${e.proyecto ?? 'sin obra'})`));
          this.dupRegistros.set(existentes); // DB5 — para «marcar presente hoy»
          this.saving.set(false);
          return;
        }
      }
      const saved = actual ? await this.service.actualizar(actual.id, payload) : await this.service.crear(payload);
      this.personal.set(saved);
      this.dupAviso.set([]);
      this.dupRegistros.set([]);
      if (!actual) this.motion.momento('entrada');
      // DB5 — en modo rápido, las 2 fotos del paso 0 se guardan como tipadas.
      if (!actual && this.rapido()) await this.subirFotosRapidas(saved);
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
    const obraRef = this.obras().find((o) => o.id === p.proyecto_id);
    return construirValoresAuto({
      empresa: this.empresa(),
      persona: {
        nombre: p.nombre, apellido: p.apellido, documento_numero: p.documento_numero, cargo, telefono: p.telefono,
        nacionalidad: NACIONALIDAD_LABEL[p.nacionalidad] ?? p.nacionalidad, // CF7
        domicilio: p.domicilio, tarifa_hora: p.tarifa_hora,
      },
      obra: { nombre: obra, cliente: (obraRef as { cliente?: string | null } | undefined)?.cliente ?? null },
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
    if (!p || this.saving()) return;
    // AZ1 (d) — nadie firma un contrato con variables sin resolver.
    if (this.plantillaActual() && this.faltanCampos()) {
      this.error.set('Completa los campos pendientes del documento antes de firmar.');
      return;
    }
    const pad = this.pad();
    if (!pad || pad.isEmpty()) { this.error.set('Dibuja la firma antes de continuar.'); return; }
    // CO16 — la bandera va antes del primer await (toBlob() también es async).
    this.saving.set(true);
    this.error.set('');
    try {
      const blob = await pad.toBlob();
      if (!blob) { this.error.set('No se pudo capturar la firma.'); return; }
      const pl = this.plantillaActual();
      // CF1 — un contrato pide empleador + 2 testigos; otros documentos sólo el empleador.
      const roles: ('empleador' | 'testigo_1' | 'testigo_2')[] =
        pl?.categoria === 'contrato' ? ['empleador', 'testigo_1', 'testigo_2'] : ['empleador'];
      await this.service.registrarFirma(p, this.documentoNombre().trim() || 'Documento', blob, {
        plantillaId: this.plantillaSel() || null,
        metodo: 'pad',
        // AZ1 (c) — snapshot: congela valores + HTML final resuelto al momento de firmar.
        valores: pl ? this.valores() : undefined,
        documentoHtml: pl ? this.plantillaHtml() : undefined,
        rolesFirma: roles,
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
    if (!p || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const num = await this.service.emitirCarnet(p.id);
      this.personal.set({ ...p, carnet_numero: num, carnet_emitido_at: new Date().toISOString() });
      // BN6 — NO saltar al resumen: al llenarse carnet_numero, el paso 4 revela el
      // carnet recién emitido (con QR) para imprimir. El usuario avanza con "Continuar".
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

  // CE16 — el usuario confirma registrar pese al duplicado.
  registrarDeTodosModos() { this.dupConfirmado.set(true); void this.guardarDatos(); }

  irPaso(n: number) { if (n >= 1 && n <= this.totalPasos && this.personal()) this.paso.set(n); }
  saltarFirma() { this.paso.set(4); }
  finalizar() {
    const p = this.personal();
    this.router.navigate(p ? ['/proyectos/personal', p.id] : ['/proyectos/personal']);
  }
}
