import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ProfileService } from '../../core/profile/profile.service';
import { getWebAppErrorCode, getWebAppErrorMessage } from '../../core/api/error-code';
import { COMMON_TIMEZONES } from './common-timezones';

@Component({
  selector: 'app-profile-page',
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.scss',
})
export class ProfilePage implements OnInit {
  private readonly profileService = inject(ProfileService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly displayName = signal('');
  protected readonly timezone = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly reason = signal<string | null>(null);
  protected readonly timezones = COMMON_TIMEZONES;

  async ngOnInit(): Promise<void> {
    this.reason.set(this.route.snapshot.queryParamMap.get('reason'));
    try {
      const profile = await this.profileService.load();
      this.displayName.set(profile.displayName ?? '');
      this.timezone.set(profile.timezone ?? null);
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    const tz = this.timezone();
    const name = this.displayName().trim();
    if (!name || !tz) return;

    this.saving.set(true);
    try {
      await this.profileService.update(name, tz);
      this.snackBar.open('Profile saved', 'Dismiss', { duration: 2500 });

      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (returnUrl) await this.router.navigateByUrl(returnUrl);
    } catch (err) {
      const code = getWebAppErrorCode(err);
      const msg =
        code === 'INVALID_TIMEZONE'
          ? 'That timezone is not recognized. Pick another.'
          : getWebAppErrorMessage(err) ?? 'Could not save profile.';
      this.snackBar.open(msg, 'Dismiss', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected detectBrowserTimezone(): void {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.timezone.set(browserTz);
  }
}
