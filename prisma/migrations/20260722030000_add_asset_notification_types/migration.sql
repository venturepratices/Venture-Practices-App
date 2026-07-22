-- Asset Approval Slice 5: notifications for upload/comment/decision/status events.
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_UPLOADED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_COMMENTED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_CHANGES_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_DUE_SOON';
