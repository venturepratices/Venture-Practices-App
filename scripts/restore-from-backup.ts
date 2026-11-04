import "dotenv/config";

import { readFileSync } from "node:fs";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import { missingV3Tables, reviveDates, snapshotHasTable, topologicalBatches } from "../src/lib/restore-helpers";

/**
 * Restores a database snapshot produced by src/lib/backup.ts back into a
 * Postgres database.
 *
 * SAFETY: point DATABASE_URL at a THROWAWAY / branch database, never production —
 * this wipes and repopulates every table. Its two jobs are (1) the real recovery
 * tool if Neon is ever lost, and (2) proving a snapshot actually round-trips.
 *
 * Usage (from the project root):
 *   npx tsx scripts/restore-from-backup.ts path/to/backup.json
 */

neonConfig.webSocketConstructor = ws;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/restore-from-backup.ts <path-to-backup.json>");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Point it at a throwaway/branch database.");
    process.exit(1);
  }

  const snapshot = JSON.parse(readFileSync(filePath, "utf8"), reviveDates) as {
    version: number;
    createdAt: string;
    counts: Record<string, number>;
    tables: Record<string, Record<string, unknown>[]>;
  };

  console.log(`Restoring snapshot v${snapshot.version} from ${snapshot.createdAt}`);
  console.log("Row counts in snapshot:", snapshot.counts);

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const t = snapshot.tables;
  const has = (key: string) => snapshotHasTable(t, key);

  // Snapshots from before v3 lack the 16 newer tables. Those tables are left
  // untouched (not wiped) rather than emptied with nothing to refill them.
  const missing = missingV3Tables(t);
  if (missing.length > 0) {
    console.warn(
      `WARNING: this snapshot (v${snapshot.version}) has no data for ${missing.length} newer table(s): ${missing.join(", ")}. ` +
        "They are left as they are in the target database (not wiped, not restored). " +
        "Rows that cascade from a wiped parent (e.g. subtasks, AI chats, calendar data) are still removed. " +
        "If the target database is empty, the Task insert will fail on the status foreign key: restore into a copy of the current database, or use a v3 snapshot."
    );
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // Wipe in reverse-dependency order so FKs never block a delete.
        // Sales tables (all onDelete: Restrict against TeamMember) are always wiped,
        // even when the snapshot has no Sales data: TeamMember is wiped below, and a
        // surviving Sales row would block that delete and roll the whole restore back.
        // SalesAuditLog is never wiped: a database trigger forbids deleting history,
        // and it has no foreign keys, so nothing here depends on it (see the insert below).
        // Bot keys would cascade away with TeamMember anyway; wiping them first keeps the order explicit.
        // Their rate-limit counters (BotTokenUsage) are not backed up and go with them.
        await tx.botToken.deleteMany();
        // The settings row has no foreign keys, so an older snapshot without it leaves it as it is.
        if (has("salesSettings")) await tx.salesSettings.deleteMany();
        await tx.salesCustomFieldValue.deleteMany();
        await tx.salesCustomField.deleteMany();
        await tx.salesFile.deleteMany();
        await tx.salesNote.deleteMany();
        await tx.salesActivity.deleteMany();
        await tx.salesLead.deleteMany();
        await tx.salesDeal.deleteMany();
        await tx.salesPerson.deleteMany();
        await tx.salesOrganization.deleteMany();
        await tx.salesStage.deleteMany();
        await tx.salesPipeline.deleteMany();
        if (has("teamMemberBusyBlocks")) await tx.teamMemberBusyBlock.deleteMany();
        if (has("teamMemberCalendarConnections")) await tx.teamMemberCalendarConnection.deleteMany();
        if (has("archivedMeetingNotes")) await tx.archivedMeetingNote.deleteMany();
        if (has("archivedClientNotes")) await tx.archivedClientNote.deleteMany();
        if (has("archivedWorkflowInstances")) await tx.archivedWorkflowInstance.deleteMany();
        if (has("archivedCampaigns")) await tx.archivedCampaign.deleteMany();
        if (has("issueRecommendations")) await tx.issueRecommendation.deleteMany();
        if (has("issues")) await tx.issue.deleteMany();
        if (has("rocks")) await tx.rock.deleteMany();
        if (has("aiMessages")) await tx.aiMessage.deleteMany();
        if (has("aiConversations")) await tx.aiConversation.deleteMany();
        await tx.notification.deleteMany();
        await tx.activityLog.deleteMany();
        await tx.archivedTask.deleteMany();
        await tx.taskLink.deleteMany();
        await tx.comment.deleteMany();
        await tx.taskAssignee.deleteMany();
        if (has("taskSubtasks")) await tx.taskSubtask.deleteMany();
        await tx.task.deleteMany();
        // Parents of Task (statusId is onDelete: Restrict) — only after Task is gone.
        if (has("privateProjects")) await tx.privateProject.deleteMany();
        if (has("priorityLevelOptions")) await tx.priorityLevelOption.deleteMany();
        await tx.workflowInstance.deleteMany();
        await tx.workflowFolder.deleteMany();
        await tx.workflowTaskTemplateAssignee.deleteMany();
        await tx.workflowTaskTemplateLink.deleteMany();
        await tx.workflowTaskTemplate.deleteMany();
        // WorkflowTaskTemplate.defaultStatusId points here, so after the line above.
        if (has("taskStatusOptions")) await tx.taskStatusOption.deleteMany();
        await tx.workflowStageTemplate.deleteMany();
        await tx.workflowTemplate.deleteMany();
        if (has("workflowTemplateFolders")) await tx.workflowTemplateFolder.deleteMany();
        await tx.campaign.deleteMany();
        await tx.taskTemplate.deleteMany();
        await tx.stageTemplate.deleteMany();
        await tx.programTemplate.deleteMany();
        await tx.assetShareLink.deleteMany();
        await tx.assetComment.deleteMany();
        await tx.assetDecision.deleteMany();
        await tx.assetReviewer.deleteMany();
        await tx.assetVersion.deleteMany();
        await tx.asset.deleteMany();
        await tx.assetFolder.deleteMany();
        await tx.landingPage.deleteMany();
        await tx.meetingNote.deleteMany();
        await tx.clientOrder.deleteMany();
        await tx.orderTemplate.deleteMany();
        await tx.planningItemLink.deleteMany();
        await tx.planningItem.deleteMany();
        await tx.planningFolder.deleteMany();
        await tx.clientNote.deleteMany();
        await tx.conversationMessage.deleteMany();
        await tx.clientHighLevelConnection.deleteMany();
        await tx.clientCredential.deleteMany();
        await tx.clientLink.deleteMany();
        await tx.clientUser.deleteMany();
        await tx.clientIntake.deleteMany();
        await tx.clientAccess.deleteMany();
        await tx.client.deleteMany();
        await tx.session.deleteMany();
        await tx.account.deleteMany();
        await tx.verificationToken.deleteMany();
        await tx.teamMember.deleteMany();

        // Re-insert in dependency order so every FK target already exists.
        if (t.teamMembers?.length) await tx.teamMember.createMany({ data: t.teamMembers as never });
        if (t.verificationTokens?.length) await tx.verificationToken.createMany({ data: t.verificationTokens as never });
        if (t.clients?.length) await tx.client.createMany({ data: t.clients as never });
        if (t.accounts?.length) await tx.account.createMany({ data: t.accounts as never });
        if (t.sessions?.length) await tx.session.createMany({ data: t.sessions as never });
        if (t.clientAccess?.length) await tx.clientAccess.createMany({ data: t.clientAccess as never });
        if (t.clientIntakes?.length) await tx.clientIntake.createMany({ data: t.clientIntakes as never });
        if (t.clientUsers?.length) await tx.clientUser.createMany({ data: t.clientUsers as never });
        if (t.clientLinks?.length) await tx.clientLink.createMany({ data: t.clientLinks as never });
        if (t.clientCredentials?.length) await tx.clientCredential.createMany({ data: t.clientCredentials as never });
        if (t.clientHighLevelConnections?.length)
          await tx.clientHighLevelConnection.createMany({ data: t.clientHighLevelConnections as never });
        if (t.conversationMessages?.length) await tx.conversationMessage.createMany({ data: t.conversationMessages as never });
        if (t.clientNotes?.length) await tx.clientNote.createMany({ data: t.clientNotes as never });
        if (t.planningFolders?.length) await tx.planningFolder.createMany({ data: t.planningFolders as never });
        if (t.planningItems?.length) await tx.planningItem.createMany({ data: t.planningItems as never });
        if (t.planningItemLinks?.length) await tx.planningItemLink.createMany({ data: t.planningItemLinks as never });
        if (t.orderTemplates?.length) await tx.orderTemplate.createMany({ data: t.orderTemplates as never });
        if (t.clientOrders?.length) await tx.clientOrder.createMany({ data: t.clientOrders as never });
        if (t.meetingNotes?.length) await tx.meetingNote.createMany({ data: t.meetingNotes as never });
        if (t.landingPages?.length) await tx.landingPage.createMany({ data: t.landingPages as never });

        // Asset tree before Campaign, since Campaign.proofAssetId points at an
        // Asset (a circular relationship at the schema level: Campaign -> Asset
        // via proofAssetId, but nothing on Asset points back at Campaign). To
        // insert both sides cleanly, Assets go in first with the full row as
        // snapshotted, then Campaigns follow and can reference them directly.
        if (t.assetFolders?.length) await tx.assetFolder.createMany({ data: t.assetFolders as never });
        if (t.assets?.length) await tx.asset.createMany({ data: t.assets as never });
        if (t.assetVersions?.length) await tx.assetVersion.createMany({ data: t.assetVersions as never });
        if (t.assetReviewers?.length) await tx.assetReviewer.createMany({ data: t.assetReviewers as never });
        if (t.assetDecisions?.length) await tx.assetDecision.createMany({ data: t.assetDecisions as never });
        if (t.assetComments?.length) {
          // AssetComment.parentId is self-referencing (threaded replies) —
          // insert in parent-before-child batches so a reply never lands
          // before the comment it replies to.
          const batches = topologicalBatches(t.assetComments as { id: string; parentId: string | null }[], "parentId");
          for (const batch of batches) await tx.assetComment.createMany({ data: batch as never });
        }
        if (t.assetShareLinks?.length) await tx.assetShareLink.createMany({ data: t.assetShareLinks as never });

        if (t.programTemplates?.length) await tx.programTemplate.createMany({ data: t.programTemplates as never });
        if (t.stageTemplates?.length) await tx.stageTemplate.createMany({ data: t.stageTemplates as never });
        if (t.taskTemplates?.length) await tx.taskTemplate.createMany({ data: t.taskTemplates as never });
        if (t.campaigns?.length) await tx.campaign.createMany({ data: t.campaigns as never });

        // Referenced by Task / WorkflowTaskTemplate / WorkflowTemplate, so they
        // must exist before the workflow + task sections below.
        if (t.taskStatusOptions?.length) await tx.taskStatusOption.createMany({ data: t.taskStatusOptions as never });
        if (t.priorityLevelOptions?.length) await tx.priorityLevelOption.createMany({ data: t.priorityLevelOptions as never });
        if (t.privateProjects?.length) await tx.privateProject.createMany({ data: t.privateProjects as never });
        if (t.workflowTemplateFolders?.length)
          await tx.workflowTemplateFolder.createMany({ data: t.workflowTemplateFolders as never });

        if (t.workflowTemplates?.length) await tx.workflowTemplate.createMany({ data: t.workflowTemplates as never });
        if (t.workflowStageTemplates?.length)
          await tx.workflowStageTemplate.createMany({ data: t.workflowStageTemplates as never });
        if (t.workflowTaskTemplates?.length)
          await tx.workflowTaskTemplate.createMany({ data: t.workflowTaskTemplates as never });
        if (t.workflowTaskTemplateLinks?.length)
          await tx.workflowTaskTemplateLink.createMany({ data: t.workflowTaskTemplateLinks as never });
        if (t.workflowTaskTemplateAssignees?.length)
          await tx.workflowTaskTemplateAssignee.createMany({ data: t.workflowTaskTemplateAssignees as never });
        if (t.workflowFolders?.length) await tx.workflowFolder.createMany({ data: t.workflowFolders as never });
        if (t.workflowInstances?.length) await tx.workflowInstance.createMany({ data: t.workflowInstances as never });

        if (t.tasks?.length) await tx.task.createMany({ data: t.tasks as never });
        if (t.taskAssignees?.length) await tx.taskAssignee.createMany({ data: t.taskAssignees as never });
        if (t.comments?.length) await tx.comment.createMany({ data: t.comments as never });
        if (t.taskSubtasks?.length) await tx.taskSubtask.createMany({ data: t.taskSubtasks as never });
        if (t.taskLinks?.length) await tx.taskLink.createMany({ data: t.taskLinks as never });
        if (t.activityLogs?.length) await tx.activityLog.createMany({ data: t.activityLogs as never });
        if (t.notifications?.length) await tx.notification.createMany({ data: t.notifications as never });
        if (t.archivedTasks?.length) await tx.archivedTask.createMany({ data: t.archivedTasks as never });
        if (t.archivedCampaigns?.length) await tx.archivedCampaign.createMany({ data: t.archivedCampaigns as never });
        if (t.archivedWorkflowInstances?.length)
          await tx.archivedWorkflowInstance.createMany({ data: t.archivedWorkflowInstances as never });
        if (t.archivedClientNotes?.length) await tx.archivedClientNote.createMany({ data: t.archivedClientNotes as never });
        if (t.archivedMeetingNotes?.length) await tx.archivedMeetingNote.createMany({ data: t.archivedMeetingNotes as never });

        // Issue.convertedTaskId / rockId are plain provenance strings, not FKs,
        // so Issues/Rocks only need their TeamMember + Client parents (above).
        if (t.issues?.length) await tx.issue.createMany({ data: t.issues as never });
        if (t.issueRecommendations?.length) await tx.issueRecommendation.createMany({ data: t.issueRecommendations as never });
        if (t.rocks?.length) await tx.rock.createMany({ data: t.rocks as never });
        if (t.aiConversations?.length) await tx.aiConversation.createMany({ data: t.aiConversations as never });
        if (t.aiMessages?.length) await tx.aiMessage.createMany({ data: t.aiMessages as never });
        if (t.teamMemberCalendarConnections?.length)
          await tx.teamMemberCalendarConnection.createMany({ data: t.teamMemberCalendarConnections as never });
        if (t.teamMemberBusyBlocks?.length) await tx.teamMemberBusyBlock.createMany({ data: t.teamMemberBusyBlocks as never });

        // Sales (after TeamMember). Deals go in before Leads because
        // SalesLead.convertedDealId points at a deal.
        if (t.salesPipelines?.length) await tx.salesPipeline.createMany({ data: t.salesPipelines as never });
        if (t.salesStages?.length) await tx.salesStage.createMany({ data: t.salesStages as never });
        if (t.salesOrganizations?.length) await tx.salesOrganization.createMany({ data: t.salesOrganizations as never });
        if (t.salesPeople?.length) await tx.salesPerson.createMany({ data: t.salesPeople as never });
        if (t.salesDeals?.length) await tx.salesDeal.createMany({ data: t.salesDeals as never });
        if (t.salesLeads?.length) await tx.salesLead.createMany({ data: t.salesLeads as never });
        if (t.salesActivities?.length) await tx.salesActivity.createMany({ data: t.salesActivities as never });
        if (t.salesNotes?.length) await tx.salesNote.createMany({ data: t.salesNotes as never });
        if (t.salesFiles?.length) await tx.salesFile.createMany({ data: t.salesFiles as never });
        if (t.salesCustomFields?.length) await tx.salesCustomField.createMany({ data: t.salesCustomFields as never });
        if (t.salesCustomFieldValues?.length) await tx.salesCustomFieldValue.createMany({ data: t.salesCustomFieldValues as never });
        // History rows already in the database stay; only ones missing from it are added back.
        if (t.salesAuditLogs?.length) await tx.salesAuditLog.createMany({ data: t.salesAuditLogs as never, skipDuplicates: true });
        if (t.botTokens?.length) await tx.botToken.createMany({ data: t.botTokens as never });
        if (t.salesSettings?.length) await tx.salesSettings.createMany({ data: t.salesSettings as never });
      },
      { timeout: 120_000 }
    );

    // Confirm the restore round-tripped by counting rows back out.
    const restored: Record<string, number> = {
      teamMembers: await prisma.teamMember.count(),
      clientAccess: await prisma.clientAccess.count(),
      accounts: await prisma.account.count(),
      sessions: await prisma.session.count(),
      verificationTokens: await prisma.verificationToken.count(),
      clients: await prisma.client.count(),
      clientIntakes: await prisma.clientIntake.count(),
      clientUsers: await prisma.clientUser.count(),
      clientLinks: await prisma.clientLink.count(),
      clientCredentials: await prisma.clientCredential.count(),
      clientHighLevelConnections: await prisma.clientHighLevelConnection.count(),
      conversationMessages: await prisma.conversationMessage.count(),
      clientNotes: await prisma.clientNote.count(),
      planningFolders: await prisma.planningFolder.count(),
      planningItems: await prisma.planningItem.count(),
      planningItemLinks: await prisma.planningItemLink.count(),
      orderTemplates: await prisma.orderTemplate.count(),
      clientOrders: await prisma.clientOrder.count(),
      meetingNotes: await prisma.meetingNote.count(),
      landingPages: await prisma.landingPage.count(),
      assetFolders: await prisma.assetFolder.count(),
      assets: await prisma.asset.count(),
      assetVersions: await prisma.assetVersion.count(),
      assetReviewers: await prisma.assetReviewer.count(),
      assetDecisions: await prisma.assetDecision.count(),
      assetComments: await prisma.assetComment.count(),
      assetShareLinks: await prisma.assetShareLink.count(),
      programTemplates: await prisma.programTemplate.count(),
      stageTemplates: await prisma.stageTemplate.count(),
      taskTemplates: await prisma.taskTemplate.count(),
      campaigns: await prisma.campaign.count(),
      workflowTemplates: await prisma.workflowTemplate.count(),
      workflowStageTemplates: await prisma.workflowStageTemplate.count(),
      workflowTaskTemplates: await prisma.workflowTaskTemplate.count(),
      workflowTaskTemplateLinks: await prisma.workflowTaskTemplateLink.count(),
      workflowTaskTemplateAssignees: await prisma.workflowTaskTemplateAssignee.count(),
      workflowFolders: await prisma.workflowFolder.count(),
      workflowInstances: await prisma.workflowInstance.count(),
      tasks: await prisma.task.count(),
      taskAssignees: await prisma.taskAssignee.count(),
      comments: await prisma.comment.count(),
      taskLinks: await prisma.taskLink.count(),
      activityLogs: await prisma.activityLog.count(),
      notifications: await prisma.notification.count(),
      archivedTasks: await prisma.archivedTask.count(),
      aiConversations: await prisma.aiConversation.count(),
      aiMessages: await prisma.aiMessage.count(),
      issues: await prisma.issue.count(),
      issueRecommendations: await prisma.issueRecommendation.count(),
      rocks: await prisma.rock.count(),
      taskStatusOptions: await prisma.taskStatusOption.count(),
      priorityLevelOptions: await prisma.priorityLevelOption.count(),
      privateProjects: await prisma.privateProject.count(),
      taskSubtasks: await prisma.taskSubtask.count(),
      workflowTemplateFolders: await prisma.workflowTemplateFolder.count(),
      archivedCampaigns: await prisma.archivedCampaign.count(),
      archivedWorkflowInstances: await prisma.archivedWorkflowInstance.count(),
      archivedClientNotes: await prisma.archivedClientNote.count(),
      archivedMeetingNotes: await prisma.archivedMeetingNote.count(),
      teamMemberCalendarConnections: await prisma.teamMemberCalendarConnection.count(),
      teamMemberBusyBlocks: await prisma.teamMemberBusyBlock.count(),
      salesPipelines: await prisma.salesPipeline.count(),
      salesStages: await prisma.salesStage.count(),
      salesOrganizations: await prisma.salesOrganization.count(),
      salesPeople: await prisma.salesPerson.count(),
      salesDeals: await prisma.salesDeal.count(),
      salesLeads: await prisma.salesLead.count(),
      salesActivities: await prisma.salesActivity.count(),
      salesNotes: await prisma.salesNote.count(),
      salesFiles: await prisma.salesFile.count(),
      salesCustomFields: await prisma.salesCustomField.count(),
      salesCustomFieldValues: await prisma.salesCustomFieldValue.count(),
      salesAuditLogs: await prisma.salesAuditLog.count(),
      botTokens: await prisma.botToken.count(),
      salesSettings: await prisma.salesSettings.count(),
    };
    console.log("Row counts after restore:", restored);

    // The history log is never wiped, so the target may hold newer rows than the
    // snapshot: for it, "at least the snapshot's rows" is a correct restore.
    const mismatches = Object.entries(snapshot.counts).filter(([key, expected]) =>
      key === "salesAuditLogs" ? restored[key] < expected : restored[key] !== expected,
    );
    if (mismatches.length > 0) {
      console.error("MISMATCH — these tables did not restore to their snapshot counts:", mismatches);
      process.exitCode = 1;
    } else {
      console.log("All table counts match the snapshot. Restore complete.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
