import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'fe_theme_mode';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly modeSignal = signal<ThemeMode>(this.loadInitial());
  readonly mode = this.modeSignal.asReadonly();

  constructor() {
    this.apply(this.modeSignal());
  }

  set(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    if (mode === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
    this.apply(mode);
  }

  cycle(): ThemeMode {
    const next: ThemeMode =
      this.modeSignal() === 'auto' ? 'light' : this.modeSignal() === 'light' ? 'dark' : 'auto';
    this.set(next);
    return next;
  }

  private loadInitial(): ThemeMode {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  }

  private apply(mode: ThemeMode): void {
    const html = document.documentElement;
    html.classList.remove('fe-light', 'fe-dark');
    if (mode === 'light') html.classList.add('fe-light');
    if (mode === 'dark') html.classList.add('fe-dark');
  }
}
