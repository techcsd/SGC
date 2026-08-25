import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService, UsuarioTest, TestCredenciales } from '../../../../shared/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { Rol } from '../../../../shared/models/usuario.model';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

/**
 * AY7 — Usuarios de prueba (solo admin). Crear usuarios test con rol(es) y sin
 * correo real (email sintético `t-<n>@test.constructorasd.local`, es_prueba=true).
 * El admin puede "entrar como" (conservando su sesión) o copiar credenciales.
 */
@Component({
  selector: 'app-admin-usuarios-test',
  imports: [FormsModule],
  templateUrl: './usuarios-test.html',
  styleUrl: './usuarios-test.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsuariosTest implements OnInit {
  private admin = inject(AdminService);
  private auth = inject(AuthService);

  formatTimestamp = formatTimestampDisplay;

  usuarios = signal<UsuarioTest[]>([]);
  roles = signal<Rol[]>([]);
  loading = signal(true);
  error = signal('');

  // Formulario de creación
  nombre = signal('');
  rolesSel = signal<number[]>([]);
  creando = signal(false);
  credenciales = signal<TestCredenciales | null>(null);

  entrando = signal<string | null>(null);
  eliminando = signal<string | null>(null);

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [usuarios, roles] = await Promise.all([
        this.admin.listarUsuariosTest(),
        this.admin.getAllRoles(),
      ]);
      this.usuarios.set(usuarios);
      this.roles.set(roles);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  toggleRol(id: number) {
    this.rolesSel.update((sel) => (sel.includes(id) ? sel.filter((r) => r !== id) : [...sel, id]));
  }

  async crear() {
    const nombre = this.nombre().trim();
    if (!nombre || this.creando()) return;
    this.creando.set(true);
    this.error.set('');
    this.credenciales.set(null);
    try {
      const cred = await this.admin.crearUsuarioTest(nombre, this.rolesSel());
      this.credenciales.set(cred);
      this.nombre.set('');
      this.rolesSel.set([]);
      await this.cargar();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo crear el usuario de prueba.');
    } finally {
      this.creando.set(false);
    }
  }

  /** Entra como el usuario test conservando la sesión admin (para volver luego). */
  async entrarComo(u: UsuarioTest) {
    if (this.entrando()) return;
    this.entrando.set(u.id);
    this.error.set('');
    try {
      const cred = await this.admin.credencialesEntrarComo(u.id);
      const { error } = await this.auth.impersonarUsuarioTest(cred.email, cred.password);
      if (error) throw new Error(error);
      // Recarga completa para que la app cargue el perfil del usuario test.
      window.location.assign('/');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo entrar como el usuario.');
      this.entrando.set(null);
    }
  }

  async eliminar(u: UsuarioTest) {
    if (this.eliminando()) return;
    if (!confirm(`¿Eliminar el usuario de prueba "${u.nombre}" y toda su actividad de prueba? Esta acción no se puede deshacer.`)) return;
    this.eliminando.set(u.id);
    this.error.set('');
    try {
      await this.admin.deleteUsuario(u.id);
      await this.cargar();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo eliminar.');
    } finally {
      this.eliminando.set(null);
    }
  }

  async copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); } catch { /* ignore */ }
  }
}
