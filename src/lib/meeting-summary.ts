import Anthropic from "@anthropic-ai/sdk";

const SUMMARY_PROMPT = `You're summarizing a meeting transcript for a marketing agency's internal client-notes tool. Produce a concise, structured summary in markdown with these sections (omit a section if the transcript has nothing for it):

## Key points
## Decisions
## Action items

Keep it factual and terse — this is read by teammates who weren't on the call and need to catch up fast. Do not invent content that isn't in the transcript.`;

export async function summarizeMeetingTranscript(transcript: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — required to summarize meeting transcripts.");
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SUMMARY_PROMPT,
    messages: [{ role: "user", content: transcript }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic API returned no text content for the meeting summary.");
  }

  return textBlock.text.trim();
}
