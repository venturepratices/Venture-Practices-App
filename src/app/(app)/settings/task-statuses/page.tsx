import { redirect } from "next/navigation";

// Folded into the consolidated Settings page (Task Statuses is now one of
// its three tabs) — this route just forwards anyone with the old sidebar
// link or a bookmark to the new page.
export default function TaskStatusesPage() {
  redirect("/settings");
}
