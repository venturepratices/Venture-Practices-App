// Pure helpers for the task panel's unsaved draft, kept apart from the panel
// so they can be tested without a browser.

/** The campaign select's "None" value. */
export const NO_CAMPAIGN = "__none__";

type ClientAndCampaign = { clientId: string; campaignId: string; campaignStage: string };

/**
 * The draft with its Client changed. A task's campaign must belong to the
 * task's own client (the PATCH route refuses anything else), so a campaign
 * from the client being left is cleared. Changing back to the saved client
 * puts the saved campaign and stage back, so nothing is unlinked by accident.
 */
export function draftWithClient<T extends ClientAndCampaign>(draft: T, clientId: string, saved: ClientAndCampaign): T {
  if (clientId === saved.clientId) {
    return { ...draft, clientId, campaignId: saved.campaignId, campaignStage: saved.campaignStage };
  }
  return { ...draft, clientId, campaignId: NO_CAMPAIGN };
}

/** What to tell the person when Save is refused: the server's reason when it gave one. */
export async function saveFailureMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" && body.error ? body.error : "Couldn't save your changes. Try again.";
}
