import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EmpresaService } from '../../../../shared/services/empresa.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * AG13 — Empresa / parámetros generales: datos de la constructora (razón social,
 * RNC, contacto, dirección) que pueden usarse en documentos y encabezados.
 */
@Component({
  selector: 'app-admin-empresa',
  imports: [ReactiveFormsModule, Skeleton],
  templateUrl: './empresa.html',
  styleUrl: './empresa.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminEmpresa implements OnInit {
  private svc = inject(EmpresaService);
  private fb = inject(FormBuilder);
  private toast = inject(ToastService);

  loading = signal(true);
  saving = signal(false);
  error = signal('');

  form = this.fb.group({
    razon_social: ['', [Validators.maxLength(200)]],
    nombre_comercial: ['', [Validators.maxLength(200)]],
    rnc: ['', [Validators.maxLength(20)]],
    direccion: ['', [Validators.maxLength(300)]],
    ciudad: ['', [Validators.maxLength(100)]],
    pais: ['', [Validators.maxLength(100)]],
    telefono: ['', [Validators.maxLength(30)]],
    email: ['', [Validators.email, Validators.maxLength(150)]],
    sitio_web: ['', [Validators.maxLength(150)]],
  });

  async ngOnInit() {
    try {
      const e = await this.svc.get();
      if (e) {
        this.form.patchValue({
          razon_social: e.razon_social ?? '',
          nombre_comercial: e.nombre_comercial ?? '',
          rnc: e.rnc ?? '',
          direccion: e.direccion ?? '',
          ciudad: e.ciudad ?? '',
          pais: e.pais ?? '',
          telefono: e.telefono ?? '',
          email: e.email ?? '',
          sitio_web: e.sitio_web ?? '',
        });
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la empresa.');
    } finally {
      this.loading.set(false);
    }
  }

  async guardar() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const v = this.form.value;
      await this.svc.update({
        razon_social: v.razon_social?.trim() || null,
        nombre_comercial: v.nombre_comercial?.trim() || null,
        rnc: v.rnc?.trim() || null,
        direccion: v.direccion?.trim() || null,
        ciudad: v.ciudad?.trim() || null,
        pais: v.pais?.trim() || null,
        telefono: v.telefono?.trim() || null,
        email: v.email?.trim() || null,
        sitio_web: v.sitio_web?.trim() || null,
      });
      this.toast.success('Guardado', 'Los datos de la empresa se actualizaron.');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() { return this.form.controls; }
}
