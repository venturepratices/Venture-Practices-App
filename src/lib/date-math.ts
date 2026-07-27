const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Given a campaign's in-home mail date, derive the standard back-scheduled due
 * dates (per the roadmap PDF's example timing: creative 4 weeks out, approval
 * 3 weeks out, print 2 weeks out). Stored on the Campaign row so they can be
 * manually overridden afterward without being recomputed on every read.
 */
export function computeCampaignDueDates(mailDate: Date | null): {
  creativeDueDate: Date | null;
  approvalDueDate: Date | null;
  printDueDate: Date | null;
} {
  if (!mailDate) {
    return { creativeDueDate: null, approvalDueDate: null, printDueDate: null };
  }
  return {
    creativeDueDate: new Date(mailDate.getTime() - 4 * WEEK_MS),
    approvalDueDate: new Date(mailDate.getTime() - 3 * WEEK_MS),
    printDueDate: new Date(mailDate.getTime() - 2 * WEEK_MS),
  };
}
