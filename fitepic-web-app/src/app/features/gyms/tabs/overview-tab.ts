import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { canManageGym, isOwner } from '../../../core/gyms/gym-role';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import { GymResponse } from '../../../core/api/generated/models/gym-response';
import { EditGymDialog, EditGymDialogData, EditGymDialogResult } from '../edit-gym-dialog';
import { DeleteGymDialog, DeleteGymDialogData } from '../delete-gym-dialog';

@Component({
  selector: 'app-overview-tab',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './overview-tab.html',
  styleUrl: './overview-tab.scss',
})
export class OverviewTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly rotateAction = createPendingAction<void>();
  protected readonly rotating = this.rotateAction.pending;
  protected readonly justRotated = signal(false);

  protected readonly gymId = signal<string | null>(null);
  protected readonly gym = computed<GymResponse | null>(() => {
    const id = this.gymId();
    if (!id) return null;
    return this.gymsService.gyms().find((g) => g.id === id) ?? null;
  });

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canEdit = computed(() => canManageGym(this.role()));
  protected readonly canDelete = computed(() => isOwner(this.role()));

  ngOnInit(): void {
    // Parent shell already loaded the gym; just pick up the id from the URL.
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
  }

  protected async copyCode(): Promise<void> {
    const code = this.gym()?.gymCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.snackBar.open('Gym code copied.', 'Dismiss', { duration: 2000 });
    } catch {
      this.snackBar.open('Could not copy to clipboard.', 'Dismiss', { duration: 2500 });
    }
  }

  protected async openEdit(): Promise<void> {
    const gym = this.gym();
    if (!gym?.id) return;
    const data: EditGymDialogData = {
      name: gym.name ?? '',
      description: gym.description ?? null,
    };
    const result = await this.dialog
      .open<EditGymDialog, EditGymDialogData, EditGymDialogResult | undefined>(EditGymDialog, {
        data,
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;
    try {
      await this.gymsService.updateGym(gym.id, {
        name: result.name,
        description: result.description,
      });
      this.snackBar.open('Gym updated.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not update the gym.');
    }
  }

  protected async rotateCode(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    await this.rotateAction.run(async () => {
      try {
        await this.gymsService.regenerateCode(id);
        this.justRotated.set(true);
        this.snackBar.open(
          'Gym code rotated. Pending join requests with the old code still work.',
          'Dismiss',
          { duration: 4000 },
        );
        // Visual highlight fades after a moment.
        setTimeout(() => this.justRotated.set(false), 4000);
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not rotate the gym code.');
      }
    });
  }

  protected async openDelete(): Promise<void> {
    const gym = this.gym();
    if (!gym?.id || !gym.name) return;
    const confirmed = await this.dialog
      .open<DeleteGymDialog, DeleteGymDialogData, boolean>(DeleteGymDialog, {
        data: { gymName: gym.name },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    try {
      await this.gymsService.deleteGym(gym.id);
      this.snackBar.open('Gym deleted.', 'Dismiss', { duration: 2500 });
      await this.router.navigateByUrl('/gyms');
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not delete the gym.');
    }
  }
}
