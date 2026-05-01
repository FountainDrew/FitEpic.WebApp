import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';

import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';
import { NAV_ITEMS } from './nav-items';

const RAIL_KEY = 'fe_shell_rail';

@Component({
  selector: 'app-admin-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  templateUrl: './admin-shell.html',
  styleUrl: './admin-shell.scss',
})
export class AdminShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);

  protected readonly navItems = NAV_ITEMS;
  protected readonly user = this.auth.currentUser;
  protected readonly themeMode = this.theme.mode;

  // Sidenav is always in `side` mode and always opened — toggling the menu
  // button only flips between rail (collapsed, 72px) and expanded (240px).
  // The drawer always pushes content; it never overlays.
  protected readonly collapsed = signal(this.loadRail());

  constructor() {
    effect(() => {
      localStorage.setItem(RAIL_KEY, this.collapsed() ? '1' : '0');
    });
  }

  protected toggleRail(): void {
    this.collapsed.update((v) => !v);
  }

  protected cycleTheme(): void {
    this.theme.cycle();
  }

  protected get themeIcon(): string {
    const mode = this.themeMode();
    return mode === 'dark' ? 'dark_mode' : mode === 'light' ? 'light_mode' : 'brightness_auto';
  }

  protected userInitials(): string {
    const u = this.user();
    if (!u) return '?';
    const source = (u.name ?? u.email ?? '').trim();
    if (!source) return '?';
    const parts = source.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  protected async signOut(): Promise<void> {
    this.auth.signOut();
    await this.router.navigate(['/login']);
  }

  private loadRail(): boolean {
    return localStorage.getItem(RAIL_KEY) === '1';
  }
}
