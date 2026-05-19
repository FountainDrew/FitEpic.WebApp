import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { canManageGym } from '../../../core/gyms/gym-role';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { TrainingGroupResponse } from '../../../core/api/generated/models/training-group-response';
import {
  TrainingGroupDialog,
  TrainingGroupDialogData,
  TrainingGroupDialogResult,
} from '../training-group-dialog';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';

@Component({
  selector: 'app-groups-tab',
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './groups-tab.html',
  styleUrl: './groups-tab.scss',
})
export class GroupsTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly gymId = signal<string | null>(null);
  protected readonly groups = signal<TrainingGroupResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canManage = computed(() => canManageGym(this.role()));
  protected readonly liveGroups = computed(() =>
    this.groups().filter((g) => !g.isDeleted),
  );

  async ngOnInit(): Promise<void> {
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    await this.load();
  }

  protected async openCreate(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    const data: TrainingGroupDialogData = { mode: 'create' };
    const result = await this.openDialog(data);
    if (!result) return;
    try {
      const created = await this.gymsService.createGroup(id, {
        name: result.name,
        description: result.description,
      });
      this.groups.update((list) => [...list, created]);
      this.snackBar.open('Group created.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not create the group.');
    }
  }

  protected async openEdit(group: TrainingGroupResponse): Promise<void> {
    const id = this.gymId();
    if (!id || !group.id) return;
    const data: TrainingGroupDialogData = {
      mode: 'edit',
      name: group.name ?? '',
      description: group.description ?? null,
    };
    const result = await this.openDialog(data);
    if (!result) return;
    try {
      const updated = await this.gymsService.updateGroup(id, group.id, {
        name: result.name,
        description: result.description,
      });
      this.groups.update((list) =>
        list.map((g) => (g.id === updated.id ? updated : g)),
      );
      this.snackBar.open('Group updated.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not update the group.');
    }
  }

  protected async openDelete(group: TrainingGroupResponse): Promise<void> {
    const id = this.gymId();
    if (!id || !group.id) return;
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Delete training group?',
          message: `Delete "${group.name}"? Upcoming group-scheduled workouts will be removed; completed history is preserved.`,
          confirmLabel: 'Delete',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    try {
      await this.gymsService.deleteGroup(id, group.id);
      this.groups.update((list) => list.filter((g) => g.id !== group.id));
      this.snackBar.open('Group deleted.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not delete the group.');
    }
  }

  private async openDialog(
    data: TrainingGroupDialogData,
  ): Promise<TrainingGroupDialogResult | undefined> {
    return await this.dialog
      .open<TrainingGroupDialog, TrainingGroupDialogData, TrainingGroupDialogResult>(
        TrainingGroupDialog,
        { data, width: '480px', autoFocus: 'first-tabbable' },
      )
      .afterClosed()
      .toPromise();
  }

  private async load(): Promise<void> {
    const id = this.gymId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.groups.set(await this.gymsService.listGroups(id));
    } catch {
      this.error.set('Could not load training groups.');
      this.groups.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
