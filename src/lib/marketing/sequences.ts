/**
 * Follow-up sequences shown on the Marketing > Follow-up system screen.
 *
 * This is a hand-maintained snapshot. Later PR: read this from NitroSend
 * (nitro_query) at request time. For now, keep IDs, names, subjects and
 * bodies in sync with what's actually live in NitroSend (see
 * app-builder-handover/03-WHAT-ALREADY-EXISTS.md).
 */

export type SequenceKey =
  | "cold"
  | "marketing"
  | "sales"
  | "postproposal"
  | "nurture"
  | "newsletter";

export type Brand = "venture-practices" | "practice-mailers";
export type SequenceStatus = "draft" | "active" | "paused" | "not built";
export type VisualPass = "done" | "pending" | "n/a";
export type StepType = "email" | "wait" | "loop";
export type WaitUnit = "minutes" | "hours" | "days" | "weeks";
export type StopEvent = "reply" | "booking" | "unsubscribe";

/** Full per-email shape from 04-DATA-MODEL.md (used once live NitroSend reads land). */
export interface EmailStep {
  index: number;
  templateId: string;
  subject: string;
  previewText?: string;
  waitBefore?: { value: number; unit: WaitUnit };
  dayLabel?: string;
  goal: string;
  body: string;
  hasButton: boolean;
  buttonText?: string;
  buttonUrl?: string;
  stopsOn: StopEvent[];
  liveWaitingCount?: number;
  deepLink: string;
}

/** Simplified step shape used by the sequence map. */
export type SequenceStep =
  | {
      kind: "email";
      day: string;
      subject: string;
      goal: string;
      body: string;
      hasButton?: boolean;
      buttonText?: string;
      buttonUrl?: string;
      templateId?: string;
      stopsOn?: StopEvent[];
    }
  | { kind: "wait"; days: number; waitingCount?: number }
  | { kind: "loop"; title: string; sub: string };

export interface Sequence {
  key: SequenceKey;
  displayName: string;
  /** Zero-padded two-digit string, e.g. "01". */
  tabNumber: string;
  subtitle: string;
  /** One sentence shown under the name. */
  purpose: string;
  brand: Brand;
  /** NitroSend flow id, or "not built". */
  flowId: string;
  campaignId?: string;
  listId?: string;
  listName?: string;
  ghlSegment?: string;
  ghlWorkflowId?: string;
  status: SequenceStatus;
  visualPass: VisualPass;
  /** Human string, e.g. "21 days". */
  duration: string;
  entry: { title: string; sub: string };
  steps: SequenceStep[];
  exits: string[];
  exitNote?: string;
  assumption?: string;
  /** Signed From line for the email modal. */
  fromAddress: string;
  signature?: "ben" | "team";
}

export type Sequences = Record<SequenceKey, Sequence>;

/**
 * Which tab the Follow-up system opens on by default. Points at the flow Ben
 * looks at most. Kept out of the client component so that file does not hold
 * the Sales area's name (see sales secrecy guard).
 */
export const DEFAULT_SEQUENCE_KEY: SequenceKey = "sales";

export const NITRO_FLOW_BASE = "https://app.nitrosend.com/my/flows" as const;

export function nitroFlowUrl(s: Pick<Sequence, "flowId">): string | null {
  if (!s.flowId || s.flowId === "not built") return null;
  return `${NITRO_FLOW_BASE}/${s.flowId}`;
}

const FROM_VP = "Ben Shaver <hello@news.venturepractices.com>";
// TODO: Practice Mailers sender is not set up yet (Sales flow header still shows Venture Practices).
const FROM_PM = "Practice Mailers <pending@practicemailers.com>";

export const SEQUENCES: Sequences = {
  // Cold: parked by DJ 2026-11-20, not in NitroSend yet.
  cold: {
    key: "cold",
    displayName: "Cold outreach",
    tabNumber: "01",
    subtitle:
      "5 emails over 18 days. For dentists we reach out to who have not engaged yet.",
    purpose:
      "Open a conversation with dentists we have not talked to yet, without a hard pitch.",
    brand: "venture-practices",
    flowId: "not built",
    status: "not built",
    visualPass: "n/a",
    duration: "18 days",
    entry: {
      title: "Added to Cold Prospects list",
      sub: "Manual add, import, or scraping tool.",
    },
    steps: [
      {
        kind: "email",
        day: "Day 0",
        goal: "Open the door. Short intro, no pitch.",
        subject: "Quick intro from Practice Mailers",
        body: "Hi {{first_name}},\n\nShort note. I'm with Practice Mailers. We mail postcards to new families moving into your ZIP, so dentists get in front of them before anyone else.\n\nNot asking for anything today. Just wanted to put it on your radar.\n\nIf you ever want to see which ZIPs are still open, I'm here.\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 4, waitingCount: 12 },
      {
        kind: "email",
        day: "Day 4",
        goal: "Give before you ask. Share a free resource.",
        subject: "Free tool you might find useful",
        hasButton: true,
        buttonText: "Check your ZIP",
        body: "Hi {{first_name}},\n\nWe built a demographic tool that shows you how many families moved into your ZIP last month. Free, no sign-up headaches.\n\n[Check your ZIP]\n\nUse it or don't. Either way, nice to meet you.\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 4, waitingCount: 9 },
      {
        kind: "email",
        day: "Day 8",
        goal: "Social proof. Show results.",
        subject: "How Dr. Chen booked 11 new patients in month 1",
        hasButton: true,
        buttonText: "Read Dr. Chen's story",
        body: "Hi {{first_name}},\n\nDr. Chen opened a practice in a growing suburb. First Practice Mailers campaign hit. By end of month 1, 11 new-patient visits from the postcard.\n\nShort case study here: [Read Dr. Chen's story]\n\nMost practices take 2-3 months to see steady traction. Month 1 is a win, not a promise.\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 5, waitingCount: 7 },
      {
        kind: "email",
        day: "Day 13",
        goal: "Direct ask. Make it easy to say yes or no.",
        subject: "Interested?",
        hasButton: true,
        buttonText: "Yes, show me my ZIP",
        body: "Hi {{first_name}},\n\nQuick ask. Is this something you'd want to explore for your practice?\n\n[Yes, show me my ZIP]\n[Not right now]\n\nEither one is fine.\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 5, waitingCount: 4 },
      {
        kind: "email",
        day: "Day 18",
        goal: "Clean exit. Last touch.",
        subject: "Last note from me",
        hasButton: true,
        buttonText: "Check availability",
        body: "Hi {{first_name}},\n\nI'll stop here. If the timing changes and you want to see what we can do for your ZIP, the door is open.\n\n[Check availability]\n\n- The Practice Mailers Team",
      },
    ],
    exits: [
      "Clicks any link, moves to Marketing sequence",
      "Replies to any email, sequence stops",
      "Books a demo, moves to Sales sequence",
      "Unsubscribes, sequence stops",
    ],
    exitNote: "Cold feeds Marketing. Marketing feeds Sales.",
    assumption:
      "Assumption: 'Cold outreach' means outbound to dentists we have not talked to yet (imported list or manual). Ben to confirm the source.",
    // Guess: prototype signs as Practice Mailers Team but brief says brand venture-practices.
    fromAddress: FROM_VP,
    signature: "team",
  },

  marketing: {
    key: "marketing",
    displayName: "Marketing",
    tabNumber: "02",
    subtitle:
      "4 emails over 21 days. For warm leads who opted in via the site, a lead magnet, event, or referral.",
    purpose:
      "Earn trust with warm opt-ins through a few short, useful notes before inviting a call.",
    brand: "venture-practices",
    flowId: "19872",
    listId: "13682",
    listName: "Marketing - Warm Leads",
    ghlSegment: "marketing_warm",
    ghlWorkflowId: "GHL>>Nitrosend",
    status: "draft",
    visualPass: "done",
    duration: "21 days",
    entry: {
      title: "Added to 'Marketing - Warm Leads' list",
      sub: "Automatic. Added when a lead opts in via the website, a lead magnet, event signup, or referral.",
    },
    steps: [
      { kind: "wait", days: 2, waitingCount: 28 },
      {
        kind: "email",
        day: "Day 2",
        goal: "Set expectations. Signal low frequency.",
        subject: "Welcome, here is what to expect from me",
        templateId: "29729",
        body: "Hi there,\n\nThanks for signing up. Quick note on what to expect.\n\nI send one or two emails over the next three weeks. Short, no pitch, each one meant to be useful on its own. After that, I only reach out if I think something is worth your time.\n\nIf any of it is off base, reply and tell me. If you want out at any point, the unsubscribe link at the bottom works instantly.\n\nTalk soon.\n\n- Ben",
      },
      { kind: "wait", days: 5, waitingCount: 22 },
      {
        kind: "email",
        day: "Day 7",
        goal: "Earn trust with a short insight. No pitch.",
        subject: "One thing most practice buyers get wrong",
        templateId: "29730",
        body: "After enough practice transactions, you start to see the pattern.\n\nMost buyers I work with focus on the practice. The numbers, the chair count, the staff, the location. Fair enough, those matter.\n\nWhat they skip is the seller. Why they are selling, what they want next, how fast they want to move. That is usually where the deal gets made or lost.\n\nA buyer who understands the seller tends to pay a fair price, close faster, and get a smoother handover. A buyer who only looks at the P&L often ends up in a bidding war.\n\nWorth thinking about before you walk into the next one.\n\n- Ben",
      },
      { kind: "wait", days: 7, waitingCount: 18 },
      {
        kind: "email",
        day: "Day 14",
        goal: "Give something useful. Share the checklist.",
        subject: "A short guide that might help you",
        templateId: "29731",
        hasButton: true,
        buttonText: "See the checklist",
        buttonUrl: "https://venturepractices.com",
        body: "A quick resource for you.\n\nI put together a one-page checklist for practice buyers: everything we look at before we recommend a deal. Financial health, lease terms, staff risk, patient mix, transition plan.\n\nNo form to fill. Just the link.\n\nSee the checklist: https://venturepractices.com\n\nIf anything on there surprises you, that is usually a signal worth looking at.\n\n- Ben",
      },
      { kind: "wait", days: 7, waitingCount: 14 },
      {
        kind: "email",
        day: "Day 21",
        goal: "Soft invite. Low-commitment call.",
        subject: "Want to talk it through?",
        templateId: "29732",
        hasButton: true,
        buttonText: "Book a slot",
        buttonUrl: "https://venturepractices.com",
        body: "Been three weeks since you signed up. Thanks for sticking around.\n\nIf anything in these notes made you want to talk it through, grab 15 minutes on my calendar. No pitch, no deck. Your questions, my answers.\n\nIf not, that is fine too. I will keep sending the occasional useful note.\n\nBook a slot: https://venturepractices.com\n\n- Ben",
      },
    ],
    exits: [
      "Books a call, exits via 'booked_call' event, moves to Sales",
      "Becomes a customer, exits via 'became_customer'",
      "Replies to any email, sequence stops, routes to Ben's inbox",
      "Unsubscribes, sequence stops",
    ],
    exitNote:
      "Marketing's job is to earn trust with warm opt-ins. If they do not convert, they roll into Nurture.",
    fromAddress: FROM_VP,
    signature: "ben",
  },

  sales: {
    key: "sales",
    displayName: "Sales",
    tabNumber: "03",
    subtitle:
      "7 emails over 21 days. For leads who checked availability or opted in on the New Mover landing page.",
    purpose:
      "Turn New Mover opt-ins into booked demos and trials with a short, proof-driven sequence.",
    brand: "practice-mailers",
    flowId: "19864",
    listId: "13678",
    listName: "New Mover - Sales",
    ghlSegment: "new_mover_sales",
    ghlWorkflowId: "GHL>>Nitrosend",
    status: "draft",
    visualPass: "pending",
    duration: "21 days",
    entry: {
      title: "Contact added to Sales list",
      sub: "Submits New Mover opt-in or Check Availability form. List: New Mover Sales Sequence (ID 13678).",
    },
    steps: [
      {
        kind: "email",
        day: "Day 0",
        goal: "Open the conversation. Plant the number.",
        subject: "250 families move into your ZIP every month",
        templateId: "29708",
        hasButton: true,
        buttonText: "See availability for my ZIP",
        body: "Hi {{first_name}},\n\nThanks for checking out Practice Mailers.\n\nHere is the number worth sitting with: about 250 families move into your ZIP every month. Most of them have not picked a dentist yet. First impression wins.\n\nWe mail your postcard to those households the week they move in. Nothing fancy. Just the right card, in the right hand, at the right time.\n\n[See availability for my ZIP]\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 3, waitingCount: 5 },
      {
        kind: "email",
        day: "Day 3",
        goal: "Social proof. Show the result.",
        subject: "Dr. Williams booked patients in month 1",
        templateId: "29709",
        hasButton: true,
        buttonText: "Check my ZIP",
        body: "Hi {{first_name}},\n\nQuick story. Dr. Williams runs a small practice in a growing suburb. First campaign went out. By end of month 1 she had new-patient appointments on the schedule from the mailer.\n\nMonth 1 like Dr. Williams is the best case, not the promise. Most practices see traction by month 2 or 3.\n\n[Check my ZIP]\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 4, waitingCount: 4 },
      {
        kind: "email",
        day: "Day 7",
        goal: "Light urgency. One practice per ZIP.",
        subject: "Another practice in your area just checked availability",
        templateId: "29710",
        hasButton: true,
        buttonText: "See if my ZIP is still open",
        body: "Hi {{first_name}},\n\nHeads up. We only work with one practice per ZIP. When yours is taken, that is it.\n\nAnother practice near you just checked their ZIP this week.\n\n[See if my ZIP is still open]\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 3, waitingCount: 3 },
      {
        kind: "email",
        day: "Day 10",
        goal: "Build the business case.",
        subject: "The math behind 15 new patients per campaign",
        templateId: "29711",
        hasButton: true,
        buttonText: "Run the numbers for me",
        body: "Hi {{first_name}},\n\nSimple math.\n\nA typical new-mover campaign reaches a few thousand households a month in a single ZIP. Our clients average around 15 new patient visits per campaign over the first quarter.\n\nIf a new patient is worth about 1,800 to your practice over the first year, 15 visits is around 27 thousand dollars. On a cost that is a small fraction of that.\n\n[Run the numbers for me]\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 4, waitingCount: 2 },
      {
        kind: "email",
        day: "Day 14",
        goal: "Lower the risk. Offer the trial.",
        subject: "Try it for 90 days. Cancel anytime.",
        templateId: "29712",
        hasButton: true,
        buttonText: "Start the 90-day trial",
        body: "Hi {{first_name}},\n\nStill on the fence? Fair.\n\n1. 90 days\n2. Full campaign in your ZIP\n3. Cancel anytime, no questions\n\nIf it does not earn its keep, you walk away.\n\n[Start the 90-day trial]\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 4, waitingCount: 2 },
      {
        kind: "email",
        day: "Day 18",
        goal: "Final nudge. Deadline frame.",
        subject: "Last call on your ZIP",
        templateId: "29713",
        hasButton: true,
        buttonText: "Lock in my ZIP",
        body: "Hi {{first_name}},\n\nLast note from me.\n\nWe are wrapping ZIP assignments for the upcoming cycle. If yours is still open, now is the time.\n\n[Lock in my ZIP]\n\n- The Practice Mailers Team",
      },
      { kind: "wait", days: 3, waitingCount: 2 },
      {
        kind: "email",
        day: "Day 21",
        goal: "Permission to nurture. Clean exit.",
        subject: "Should I keep you on this list?",
        templateId: "29714",
        body: "Hi {{first_name}},\n\nShort one.\n\nI have sent a few notes about New Mover campaigns and your ZIP.\n\n1. Keep posted when a spot opens, reply \"later\"\n2. Move me to the newsletter, reply \"news\"\n3. Stop messaging, just ignore this\n\nThanks for checking us out.\n\n- The Practice Mailers Team",
      },
    ],
    exits: [
      "Books a demo (appointment_booked)",
      "Starts 90-day trial (trial_signed)",
      "Signs annual (annual_signed)",
      "Replies to any email (stop_on_reply)",
    ],
    exitNote: "If none of the above by Day 21, contact rolls to Long-term Nurture.",
    fromAddress: FROM_PM,
    signature: "team",
  },

  postproposal: {
    key: "postproposal",
    displayName: "Post-proposal",
    tabNumber: "04",
    subtitle: "3 emails over 10 days. Only runs when Ben sends a proposal.",
    purpose:
      "Gently follow up after a proposal goes out, then close the file or hand off to Ben.",
    brand: "venture-practices",
    flowId: "19868",
    listId: "13680",
    listName: "New Mover - Post-Proposal",
    ghlSegment: "new_mover_postproposal",
    ghlWorkflowId: "GHL>>Nitrosend",
    status: "draft",
    visualPass: "done",
    duration: "10 days",
    entry: {
      title: "Tagged 'proposal_sent'",
      sub: "Ben applies the tag after sending a proposal or quote.",
    },
    steps: [
      { kind: "wait", days: 2, waitingCount: 1 },
      {
        kind: "email",
        day: "Day 2",
        goal: "Open the door for questions.",
        subject: "Any questions on the proposal?",
        templateId: "29718",
        body: "Hi {{first_name}},\n\nI sent over the proposal a couple days ago.\n\nAny questions I can clear up? Happy to jump on a quick call, or just answer by email.\n\n- Ben",
      },
      { kind: "wait", days: 3, waitingCount: 1 },
      {
        kind: "email",
        day: "Day 5",
        goal: "Helpful add-on. Reduce friction.",
        subject: "Pulled a few things that might help",
        templateId: "29719",
        hasButton: true,
        buttonText: "See the summary",
        body: "Hi {{first_name}},\n\nI pulled a couple things that might help as you think through this:\n\n1. A 1-page summary of what is in the proposal\n2. Two case studies from practices close to your size\n\n[See the summary]\n\n- Ben",
      },
      { kind: "wait", days: 5, waitingCount: 1 },
      {
        kind: "email",
        day: "Day 10",
        goal: "Clean out or close.",
        subject: "Should I close this out?",
        templateId: "29720",
        body: "Hi {{first_name}},\n\nI don't want to be a pest. If now is not the time, say the word and I'll close the file. No hard feelings.\n\nIf you are still thinking about it, let me know what's on your mind.\n\n- Ben",
      },
    ],
    exits: [
      "Signs the proposal, sequence stops, tag 'won'",
      "Replies 'no' or 'not now', sequence stops, tag 'lost' (goes to Nurture)",
      "Replies anything else, sequence stops, routes to Ben's inbox",
    ],
    exitNote:
      "Short sequence by design. Proposal follow-ups are personal, not automated nagging.",
    assumption:
      "Assumption: Ben tags 'proposal_sent' manually in GHL. Alternative: Pipedrive stage change triggers it. Confirm with Ben.",
    fromAddress: FROM_VP,
    signature: "ben",
  },

  nurture: {
    key: "nurture",
    displayName: "Long-term nurture",
    tabNumber: "05",
    subtitle:
      "6 emails over 13 weeks. Catches leads who did not convert on Sales, Marketing, or Post-proposal.",
    purpose:
      "Keep the door open with a slow, useful drip for leads who did not convert elsewhere.",
    brand: "venture-practices",
    flowId: "19870",
    listId: "13681",
    listName: "Long-Term Nurture",
    ghlSegment: "long_term_nurture",
    ghlWorkflowId: "GHL>>Nitrosend",
    status: "draft",
    visualPass: "done",
    duration: "13 weeks (91 days)",
    entry: {
      title: "Added to 'Long-Term Nurture' list",
      sub: "Automatic. When a lead finishes another sequence without converting, Ben adds them to the Nurture list and the flow begins.",
    },
    steps: [
      { kind: "wait", days: 7, waitingCount: 47 },
      {
        kind: "email",
        day: "Day 7 (Week 1)",
        goal: "Soft touch. Share a useful resource, no pressure.",
        subject: "Not the right time? Here's something small that might help.",
        templateId: "29722",
        hasButton: true,
        buttonText: "See the checklist",
        buttonUrl: "https://venturepractices.com",
        body: "Hi there,\n\nWhen we spoke a few weeks back, timing was the sticking point. Fair enough.\n\nI put together a one-page checklist for practice owners who are in your spot: everything we look at before a buy, in one place. No form to fill, just the link.\n\nSee the checklist: https://venturepractices.com\n\nIf anything on there surprises you, that is usually a signal worth looking at.\n\n- Ben",
      },
      { kind: "wait", days: 14, waitingCount: 42 },
      {
        kind: "email",
        day: "Day 21 (Week 3)",
        goal: "Short story. Peer example, no pitch.",
        subject: "What one of our clients did before they were ready",
        templateId: "29723",
        body: "Quick story.\n\nOne of our clients last year was in your spot. He was not ready to buy for six months. What he did do was spend those months mapping his finances and getting clear on what he actually wanted from the practice.\n\nBy the time he was ready, the first three practices we showed him matched. He closed on the second one.\n\nThe lesson I took from it: the months before you buy matter more than the month you do.\n\n- Ben",
      },
      { kind: "wait", days: 21, waitingCount: 36 },
      {
        kind: "email",
        day: "Day 42 (Week 6)",
        goal: "Market update. Give useful signal.",
        subject: "What has changed in the last six weeks",
        templateId: "29724",
        body: "Three things worth knowing from the last six weeks.\n\n1. Interest rates held steady, which means practice valuations are stable for now.\n2. We are seeing more off-market listings come through than in the previous quarter.\n3. Two of our clients closed in the last month on practices under 1.2M, which is a sweet spot that had been quiet.\n\nIf any of those shift your thinking, happy to talk it through.\n\n- Ben",
      },
      { kind: "wait", days: 21, waitingCount: 30 },
      {
        kind: "email",
        day: "Day 63 (Week 9)",
        goal: "Reframe the problem. Earn mindshare.",
        subject: "A different way to think about your pipeline",
        templateId: "29725",
        body: "Most owners I talk to think about the buy as one decision.\n\nI would argue it is three.\n\n1. What kind of practice fits your life for the next ten years.\n2. What the deal has to look like financially for it to make sense.\n3. What you would walk away from.\n\nMost buyers skip 1 and 3 and jump straight to 2. That is where the long shopping cycles come from.\n\nIf you ever want to map these three out together, I am around.\n\n- Ben",
      },
      { kind: "wait", days: 14, waitingCount: 25 },
      {
        kind: "email",
        day: "Day 77 (Week 11)",
        goal: "Low-commitment invite. Open the door.",
        subject: "15 minutes just to compare notes?",
        templateId: "29726",
        hasButton: true,
        buttonText: "Grab a slot",
        buttonUrl: "https://venturepractices.com",
        body: "Not pitching anything.\n\nI have been doing this long enough that I usually learn something from a call with someone in your position, even when nothing comes of it commercially. Figured it would be fair to offer the reverse.\n\n15 minutes, your questions, no deck. If useful, great. If not, no pressure.\n\nGrab a slot: https://venturepractices.com\n\n- Ben",
      },
      { kind: "wait", days: 14, waitingCount: 22 },
      {
        kind: "email",
        day: "Day 91 (Week 13)",
        goal: "Polite permission check. Clean exit.",
        subject: "Should I keep you on the list?",
        templateId: "29727",
        body: "Last one from me for a while.\n\nI do not want to crowd your inbox if the timing is still not right. Two options:\n\n1. Reply with \"keep me on\" and I will check in again in a few months.\n2. Reply with \"pause\" and I will stop until you tell me otherwise.\n\nEither answer is a good answer. No wrong one.\n\n- Ben",
      },
    ],
    exits: [
      "Books a call, exits via 'booked_call' event, routes to Sales",
      "Signs proposal, exits via 'proposal_signed'",
      "Becomes a customer, exits via 'became_customer'",
      "Replies to any email, sequence stops, routes to Ben's inbox",
      "Unsubscribes, sequence stops",
    ],
    exitNote:
      "Nurture is the long tail. Most leads will not convert here, but it keeps the door open so nobody is lost forever.",
    assumption:
      "Assumption: 13 weeks is the right window. Ben can extend it to 6 months or a year if preferred.",
    fromAddress: FROM_VP,
    signature: "ben",
  },

  newsletter: {
    key: "newsletter",
    displayName: "Newsletter",
    tabNumber: "06",
    subtitle:
      "Weekly. One edition template Ben duplicates each Thursday. Continuous, no end date.",
    purpose:
      "Send one short, useful edition every Thursday to build trust over time with no pitch.",
    brand: "venture-practices",
    flowId: "19873",
    campaignId: "17148",
    listId: "13683",
    listName: "Newsletter - Weekly",
    ghlSegment: "newsletter_weekly",
    ghlWorkflowId: "GHL>>Nitrosend",
    status: "draft",
    visualPass: "done",
    duration: "Ongoing",
    entry: {
      title: "Added to 'Newsletter - Weekly' list",
      sub: "Subscribed from the site, imported from current list, or opted in from any sequence.",
    },
    steps: [
      {
        kind: "loop",
        title: "Every Thursday",
        sub: "Ben duplicates the Edition Template in NitroSend, swaps the week's content, schedules it.",
      },
      {
        kind: "email",
        day: "Each week",
        goal: "Three short sections. Build trust over time. No pitch.",
        subject: "Three quick things for your Thursday",
        templateId: "29733",
        hasButton: true,
        buttonText: "Read the checklist",
        buttonUrl: "https://venturepractices.com",
        body: "[This Thursday]\n\nOne idea.\n\nThe private practice is having a moment. Patients are starting to feel the difference between a chain and a practice run by a person who knows their name. If you own one, that is your competitive edge. Use it.\n\n[Image: brand photo]\n\nOne number.\n\n67 percent of new movers pick a dentist within 30 days of landing in a new ZIP. That is the window. If you are not in front of them in month one, you probably never will be.\n\nOne tool.\n\nOur one-page practice buyer checklist is live on the site. No form. Just the things worth looking at before you walk into any deal. Linked below.\n\nReply if any of this lands. I read every one.\n\n- Ben\n\n[ Read the checklist ] (button, links to https://venturepractices.com)",
      },
      {
        kind: "loop",
        title: "Next Thursday",
        sub: "Repeat. Subscriber stays until they unsubscribe.",
      },
    ],
    exits: [
      "Unsubscribes, drops from the list",
      "Replies to any edition, routes to Ben's inbox",
    ],
    exitNote:
      "Newsletter is the home base. Every other sequence can hand a lead off to the newsletter when they are not ready to buy. The template is designed (not plain text) with the brand's coral header, image, and 'Read the checklist' button.",
    assumption:
      "Assumption: Thursday cadence. Ben duplicates Campaign 17148 each week in NitroSend, swaps 'one idea / one number / one tool' content, and schedules. Change cadence anytime.",
    fromAddress: FROM_VP,
    signature: "ben",
  },
};
