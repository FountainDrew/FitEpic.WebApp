import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-schedule-tab',
  imports: [MatCardModule, MatIconModule],
  template: `
    <mat-card class="schedule-pending">
      <mat-card-content class="schedule-pending-content">
        <mat-icon class="pending-icon">pending_actions</mat-icon>
        <div>
          <h3 class="pending-title">Scheduling is on hold</h3>
          <p class="pending-body">
            Group scheduling needs an API contract update before the web app can wire it up — the
            <code>ScheduledWorkoutRequest</code> schema doesn't yet accept a
            <code>trainingGroupId</code> with a nullable <code>athleteId</code>. We've filed Q11
            in the contract document and will enable this tab once the schema lands.
          </p>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .schedule-pending {
        border: 1px dashed var(--fe-border);
        max-width: 720px;
      }
      .schedule-pending-content {
        display: flex;
        align-items: flex-start;
        gap: 16px;
      }
      .pending-icon {
        color: var(--fe-text);
        opacity: 0.5;
      }
      .pending-title {
        margin: 0 0 4px;
        font-size: 16px;
        font-weight: 600;
      }
      .pending-body {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        opacity: 0.85;
      }
      code {
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.9em;
        background: rgba(0, 0, 0, 0.05);
        padding: 1px 4px;
        border-radius: 3px;
      }
    `,
  ],
})
export class ScheduleTab {}
