import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

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
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly navItems = NAV_ITEMS;
  protected readonly user = this.auth.currentUser;
  protected readonly themeMode = this.theme.mode;

  private readonly isHandset = toSignal(
    this.breakpoints.observe([Breakpoints.Handset, Breakpoints.Small]).pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  protected readonly rail = signal(this.loadRail());
  protected readonly mobileOpen = signal(false);

  protected readonly mode = computed(() => (this.isHandset() ? 'over' : 'side'));
  protected readonly opened = computed(() => (this.isHandset() ? this.mobileOpen() : true));
  protected readonly collapsed = computed(() => !this.isHandset() && this.rail());

  constructor() {
    effect(() => {
      localStorage.setItem(RAIL_KEY, this.rail() ? '1' : '0');
    });
  }

  protected toggleRail(): void {
    if (this.isHandset()) {
      this.mobileOpen.update((v) => !v);
    } else {
      this.rail.update((v) => !v);
    }
  }

  protected onNavClick(): void {
    if (this.isHandset()) {
      this.mobileOpen.set(false);
    }
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
