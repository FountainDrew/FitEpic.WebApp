import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../core/gyms/gyms.service';
import { GymRole } from '../../core/api/generated/models/gym-role';
import { showGymError } from '../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../core/async/pending-action';

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

@Component({
  selector: 'app-join-gym-page',
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './join-gym-page.html',
  styleUrl: './join-gym-page.scss',
})
export class JoinGymPage {
  private readonly gymsService = inject(GymsService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly code = signal('');
  protected readonly role = signal<GymRole>('Athlete');
  protected readonly submitAction = createPendingAction<void>();
  protected readonly submitting = this.submitAction.pending;

  protected readonly roleOptions: GymRole[] = ['Athlete', 'Coach'];
  protected readonly canSubmit = computed(
    () => CODE_PATTERN.test(this.code().trim()) && !this.submitting(),
  );

  protected async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    await this.submitAction.run(async () => {
      try {
        const clientId = crypto.randomUUID();
        await this.gymsService.submitJoinRequest(
          this.code().trim().toUpperCase(),
          this.role(),
          clientId,
        );
        this.snackBar.open('Join request sent.', 'Dismiss', { duration: 2500 });
        await this.router.navigateByUrl('/gyms/my-inbox');
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not submit join request.');
      }
    });
  }
}
