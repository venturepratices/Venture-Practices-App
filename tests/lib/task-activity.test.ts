import { describe, expect, it } from "vitest";

import { buildTaskActivityEvents, categoryOf, type ActivityLogRow } from "@/lib/task-activity";

function log(partial: Partial<ActivityLogRow> & Pick<ActivityLogRow, "action" | "description">): ActivityLogRow {
  return { id: "log1", actorName: "Ben", details: null, createdAt: "2026-09-24T14:00:00.000Z", ...partial };
}

describe("buildTaskActivityEvents", () => {
  it("splits a legacy multi-change update without breaking comma-separated assignee lists", () => {
    const events = buildTaskActivityEvents(
      [
        log({
          action: "updated",
          description: 'Ben updated "October Socials": status changed to In Progress, assignees changed to Ashley, Ben, deadline changed to 10/15/2026',
        }),
      ],
      []
    );
    expect(events.map((e) => (e.kind === "text" ? e.text : null))).toEqual([
      "changed status to In Progress",
      "changed assignees to Ashley, Ben",
      "changed the due date to 10/15/2026",
    ]);
    expect(events.map(categoryOf)).toEqual(["status", "assignees", "deadline"]);
  });

  it("expands structured changes into one row per field, in recorded order", () => {
    const events = buildTaskActivityEvents(
      [
        log({
          action: "updated",
          description: "ignored when details are present",
          details: {
            changes: [
              { field: "deadline", from: { label: "Sep 30, 2026" }, to: { label: "Oct 15, 2026" } },
              { field: "assignees", from: null, to: { label: "Ashley" }, added: ["Ashley"], removed: [] },
            ],
          },
        }),
      ],
      []
    );
    expect(events).toHaveLength(2);
    expect(events[0].kind === "change" && events[0].change.field).toBe("deadline");
    expect(events[1].kind === "change" && events[1].change.field).toBe("assignees");
    expect(events[0].id).not.toBe(events[1].id);
  });

  it("uses comments from the Comment table and drops the bodiless 'commented' log rows", () => {
    const events = buildTaskActivityEvents(
      [log({ action: "commented", description: 'Ben commented on "October Socials"' })],
      [{ id: "c1", body: "<p>Looks good</p>", createdAt: "2026-09-24T15:00:00.000Z", author: null }]
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "comment", body: "<p>Looks good</p>", actorName: "Former team member" });
  });

  it("marks recurring auto-created tasks as automatic with no actor", () => {
    const [event] = buildTaskActivityEvents(
      [log({ actorName: null, action: "created", description: 'Automatically created the next occurrence of "October Socials"' })],
      []
    );
    expect(event).toMatchObject({ kind: "text", icon: "auto", automatic: true, actorName: null });
  });

  it("reads a link label out of a legacy description even when the task title has quotes", () => {
    const [event] = buildTaskActivityEvents(
      [log({ action: "link_added", description: 'Ben added the link "Brief" to "Q4 "Big" launch"' })],
      []
    );
    expect(event.kind === "text" && event.text).toBe('added the link "Brief"');
  });

  it("rewords automatic priority escalation, including overdue days", () => {
    const [event] = buildTaskActivityEvents(
      [log({ actorName: null, action: "updated", description: "Priority automatically escalated from no priority to Urgent (due in -6 days)" })],
      []
    );
    expect(event).toMatchObject({
      kind: "text",
      text: "Priority raised automatically from no priority to Urgent — 6 days overdue",
      category: "status",
      automatic: true,
    });
  });

  it("handles campaign auto-complete, archive and restore rows", () => {
    const events = buildTaskActivityEvents(
      [
        log({ id: "a", actorName: null, action: "status_changed", description: '"Proof" auto-completed — proof asset approved', createdAt: "2026-09-24T03:00:00.000Z" }),
        log({ id: "b", action: "archived", description: 'Ben archived task "Proof"', createdAt: "2026-09-24T02:00:00.000Z" }),
        log({ id: "c", action: "restored", description: 'Ben restored task "Proof" from the archive', createdAt: "2026-09-24T01:00:00.000Z" }),
      ],
      []
    );
    expect(events.map((e) => (e.kind === "text" ? e.text : null))).toEqual([
      "Marked complete automatically — proof asset approved",
      "archived this task",
      "restored this task from the archive",
    ]);
  });

  it("orders newest first across logs and comments", () => {
    const events = buildTaskActivityEvents(
      [
        log({ id: "old", action: "created", description: 'Ben created task "X"', createdAt: "2026-09-20T10:00:00.000Z" }),
        log({ id: "new", action: "deleted", description: 'Ben archived task "X"', createdAt: "2026-09-25T10:00:00.000Z" }),
      ],
      [{ id: "c1", body: "hi", createdAt: "2026-09-22T10:00:00.000Z", author: { name: "Ashley" } }]
    );
    expect(events.map((e) => e.id)).toEqual(["new", "comment:c1", "old"]);
  });
});
