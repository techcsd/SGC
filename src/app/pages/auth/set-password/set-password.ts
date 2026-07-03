import { Component, ChangeDetectionStrategy, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { SupabaseService } from '../../../core/services/supabase.service';

// Lands here from an invite or password-recovery email link. Supabase's JS
// client parses the access/refresh tokens out of the URL hash on load
// (detectSessionInUrl, on by default) and turns them into a real session —
// there's nothing for this component to read from the URL itself, it just
// waits for that session to appear before letting the user set a password.
@Component({
  selector: 'app-set-password',
  imports: [ReactiveFormsModule, NgOptimizedImage, RouterLink],
  templateUrl: './set-password.html',
  styleUrl: './set-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPassword implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  checking = signal(true);
  ready = signal(false);
  invalidLink = signal(false);
  loading = signal(false);
  errorMessage = signal('');
  showPassword = signal(false);

  private unsubscribe: (() => void) | null = null;

  form = new FormGroup({
    password: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirmPassword: new FormControl('', [Validators.required]),
  });

  get password() {
    return this.form.controls.password;
  }

  get confirmPassword() {
    return this.form.controls.confirmPassword;
  }

  async ngOnInit() {
    const session = await this.authService.getSession();
    if (session) {
      this.checking.set(false);
      this.ready.set(true);
      return;
    }

    // The SDK may still be parsing the URL hash asynchronously — give it a
    // short window before concluding the link is invalid/expired.
    const { data } = this.supabase.client.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) {
        this.checking.set(false);
        this.ready.set(true);
        this.unsubscribe?.();
      }
    });
    this.unsubscribe = () => data.subscription.unsubscribe();

    setTimeout(() => {
      if (!this.ready()) {
        this.checking.set(false);
        this.invalidLink.set(true);
        this.unsubscribe?.();
      }
    }, 3000);
  }

  ngOnDestroy() {
    this.unsubscribe?.();
  }

  togglePassword() {
    this.showPassword.update((v) => !v);
  }

  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) return;

    const { password, confirmPassword } = this.form.value as { password: string; confirmPassword: string };
    if (password !== confirmPassword) {
      this.errorMessage.set('Las contraseñas no coinciden.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    const { error } = await this.authService.updateUser(password);
    if (error) {
      this.loading.set(false);
      this.errorMessage.set('No se pudo establecer la contraseña. Intenta de nuevo.');
      return;
    }

    const user = await this.authService.getUser();
    if (user) {
      await this.userService.loadProfile(user.id);
    }

    this.router.navigate(['/dashboard']);
  }
}
