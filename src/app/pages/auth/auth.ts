import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';

@Component({
  selector: 'app-auth',
  imports: [ReactiveFormsModule, NgOptimizedImage],
  templateUrl: './auth.html',
  styleUrl: './auth.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Auth {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);

  loading = signal(false);
  errorMessage = signal('');
  showPassword = signal(false);
  showPin = signal(false);

  // P5 — 'empleado' (correo + contraseña) o 'conductor' (cédula + PIN).
  mode = signal<'empleado' | 'conductor'>('empleado');

  forgotMode = signal(false);
  forgotSent = signal(false);
  forgotLoading = signal(false);

  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required]),
  });

  // P5 — login de conductor: cédula + PIN de 6 dígitos.
  conductorForm = new FormGroup({
    cedula: new FormControl('', [Validators.required]),
    pin: new FormControl('', [Validators.required, Validators.pattern(/^\d{6}$/)]),
  });

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  get cedula() {
    return this.conductorForm.controls.cedula;
  }

  get pin() {
    return this.conductorForm.controls.pin;
  }

  setMode(m: 'empleado' | 'conductor') {
    this.mode.set(m);
    this.errorMessage.set('');
  }

  togglePassword() {
    this.showPassword.update((v) => !v);
  }

  togglePin() {
    this.showPin.update((v) => !v);
  }

  async onSubmit() {
    if (this.form.invalid || this.loading()) return;

    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.loading.set(true);
    this.errorMessage.set('');

    const { email, password } = this.form.value as { email: string; password: string };

    const { user, error } = await this.authService.signIn(email, password);

    if (error || !user) {
      this.loading.set(false);
      const msg = error?.message ?? '';
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        this.errorMessage.set('Correo o contraseña incorrectos.');
      } else if (msg.includes('Email not confirmed')) {
        this.errorMessage.set('Debes confirmar tu correo antes de iniciar sesión.');
      } else {
        this.errorMessage.set('Error al iniciar sesión. Intenta de nuevo.');
      }
      return;
    }

    await this.afterAuthenticated(user.id);
  }

  /** P5 — login de conductor por cédula + PIN. */
  async onConductorSubmit() {
    this.conductorForm.markAllAsTouched();
    if (this.conductorForm.invalid || this.loading()) return;

    this.loading.set(true);
    this.errorMessage.set('');

    const { cedula, pin } = this.conductorForm.value as { cedula: string; pin: string };
    const res = await this.authService.conductorLogin(cedula, pin);

    if (res.error || !res.user) {
      this.loading.set(false);
      if (res.retryInSeconds && res.retryInSeconds > 0) {
        const min = Math.max(1, Math.ceil(res.retryInSeconds / 60));
        this.errorMessage.set(`Demasiados intentos. Intenta de nuevo en ~${min} min.`);
      } else {
        this.errorMessage.set(res.error ?? 'No se pudo iniciar sesión.');
      }
      return;
    }

    await this.afterAuthenticated(res.user.id);
  }

  /** Carga el perfil, valida que exista y esté activo, y navega al dashboard. */
  private async afterAuthenticated(userId: string) {
    await this.userService.loadProfile(userId);
    const profile = this.userService.profile();

    if (!profile) {
      await this.authService.signOut();
      this.loading.set(false);
      this.errorMessage.set('No se pudo cargar tu perfil. Contacta al administrador.');
      return;
    }

    if (!profile.activo) {
      await this.authService.signOut();
      this.loading.set(false);
      this.errorMessage.set('Tu cuenta está desactivada. Contacta al administrador.');
      return;
    }

    this.router.navigate(['/dashboard']);
  }

  openForgot() {
    this.errorMessage.set('');
    this.forgotSent.set(false);
    this.forgotMode.set(true);
  }

  closeForgot() {
    this.forgotMode.set(false);
  }

  async onForgotSubmit() {
    if (this.email.invalid || this.forgotLoading()) {
      this.email.markAsTouched();
      return;
    }

    this.forgotLoading.set(true);
    // Always show the same confirmation regardless of whether the email
    // matches a real account — prevents leaking which emails are registered.
    await this.authService.resetPassword(this.email.value!);
    this.forgotLoading.set(false);
    this.forgotSent.set(true);
  }
}
