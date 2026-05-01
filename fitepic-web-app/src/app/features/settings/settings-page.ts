import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ProfileService } from '../../core/profile/profile.service';
import { QuoteService } from '../../core/quotes/quote.service';
import { getWebAppErrorCode, getWebAppErrorMessage } from '../../core/api/error-code';
import { COMMON_TIMEZONES } from './common-timezones';

@Component({
  selector: 'app-settings-page',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements OnInit {
  private readonly profileService = inject(ProfileService);
  private readonly quotes = inject(QuoteService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly displayName = signal('');
  protected readonly timezone = signal<string | null>(null);
  protected readonly profileLoading = signal(true);
  protected readonly profileSaving = signal(false);
  protected readonly reason = signal<string | null>(null);
  protected readonly timezones = COMMON_TIMEZONES;

  protected readonly quoteCount = signal<number | null>(null);
  protected readonly quoteCountLoading = signal(true);

  protected readonly canSaveProfile = computed(
    () => !this.profileSaving() && this.displayName().trim().length > 0 && !!this.timezone(),
  );

  async ngOnInit(): Promise<void> {
    this.reason.set(this.route.snapshot.queryParamMap.get('reason'));
    await Promise.allSettled([this.loadProfile(), this.loadQuoteCount()]);
  }

  protected async saveProfile(): Promise<void> {
    if (!this.canSaveProfile()) return;
    this.profileSaving.set(true);
    try {
      await this.profileService.update(this.displayName().trim(), this.timezone());
      this.snackBar.open('Profile saved.', 'Dismiss', { duration: 2500 });

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
      this.profileSaving.set(false);
    }
  }

  protected detectBrowserTimezone(): void {
    this.timezone.set(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  private async loadProfile(): Promise<void> {
    this.profileLoading.set(true);
    try {
      const profile = await this.profileService.load();
      this.displayName.set(profile.displayName ?? '');
      this.timezone.set(profile.timezone ?? null);
    } finally {
      this.profileLoading.set(false);
    }
  }

  private async loadQuoteCount(): Promise<void> {
    this.quoteCountLoading.set(true);
    try {
      // pageSize=1 is the cheapest way to read totalCount.
      const res = await this.quotes.listMine(1, 1);
      this.quoteCount.set(res.totalCount ?? 0);
    } catch {
      this.quoteCount.set(null);
    } finally {
      this.quoteCountLoading.set(false);
    }
  }
}
