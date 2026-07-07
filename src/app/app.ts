import { Component, ChangeDetectionStrategy, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { UserService } from './core/services/user.service';
import { ToastComponent } from '../shared/components/toast/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);

  ngOnInit() {
    this.authService.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        this.userService.clearProfile();
        this.router.navigate(['/auth']);
      }
    });
  }
}
