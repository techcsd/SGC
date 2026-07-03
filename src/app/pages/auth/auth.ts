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

  forgotMode = signal(false);
  forgotSent = signal(false);
  forgotLoading = signal(false);

  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required]),
  });

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  togglePassword() {
    this.showPassword.update((v) => !v);
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

    await this.userService.loadProfile(user.id);

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
