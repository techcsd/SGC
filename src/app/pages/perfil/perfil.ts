import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UserService } from '../../core/services/user.service';
import { MODULOS_DISPONIBLES } from '../../../shared/services/roles.service';

@Component({
  selector: 'app-perfil',
  imports: [DatePipe, RouterLink],
  templateUrl: './perfil.html',
  styleUrl: './perfil.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Perfil {
  private userService = inject(UserService);

  profile = this.userService.profile;
  avatarUrl = this.userService.avatarUrl;

  uploading = signal(false);
  error = signal('');

  roles = computed(() => this.profile()?.roles?.map((r) => r.rol) ?? []);

  async onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading.set(true);
    this.error.set('');
    try {
      await this.userService.uploadAvatar(file);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al subir la imagen.');
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  iniciales(): string {
    const nombre = this.profile()?.nombre ?? '';
    return nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  moduloLabel(key: string): string {
    return MODULOS_DISPONIBLES.find((m) => m.key === key)?.label ?? key;
  }
}
