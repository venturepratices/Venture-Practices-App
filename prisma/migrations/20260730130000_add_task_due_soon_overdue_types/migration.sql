-- Task due-soon/overdue notifications, mirroring the existing ASSET_DUE_SOON cron.
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OVERDUE';
