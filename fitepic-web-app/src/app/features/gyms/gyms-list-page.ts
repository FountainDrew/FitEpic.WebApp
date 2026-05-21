import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../core/gyms/gyms.service';
import { GymRoleService } from '../../core/gyms/gym-role.service';
import { ProfileService } from '../../core/profile/profile.service';
import { GymResponse } from '../../core/api/generated/models/gym-response';
import { EffectiveGymRole } from '../../core/gyms/gym-role';
import { showGymError } from '../../core/gyms/gym-error-messages';
import { CreateGymDialog, CreateGymDialogResult } from './create-gym-dialog';

@Component({
  selector: 'app-gyms-list-page',
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  templateUrl: './gyms-list-page.html',
  styleUrl: './gyms-list-page.scss',
})
export class GymsListPage implements OnInit {
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly gyms = this.gymsService.gyms;
  protected readonly roles = this.roleService.roles;
  protected readonly isGymOwner = computed(
    () => this.profileService.profile()?.isGymOwner ?? false,
  );
  protected readonly liveGyms = computed(() => this.gyms().filter((g) => !g.isDeleted));

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.gymsService.bootstrap();
    } catch {
      this.error.set('Could not load your gyms. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected roleFor(gym: GymResponse): EffectiveGymRole | null {
    return gym.id ? (this.roles()[gym.id] ?? null) : null;
  }

  protected async openCreate(): Promise<void> {
    const result = await this.dialog
      .open<CreateGymDialog, void, CreateGymDialogResult | undefined>(CreateGymDialog, {
        width: '480px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;
    try {
      const gym = await this.gymsService.createGym({
        name: result.name,
        description: result.description,
      });
      this.snackBar.open(`Created "${gym.name}".`, 'Dismiss', { duration: 2500 });
      if (gym.id) await this.router.navigateByUrl(`/gyms/${gym.id}`);
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not create the gym.');
    }
  }
}
