import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Sparkles, XCircle } from "lucide-react";

import { loadPermissions } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings → AI Assistant — the "connect Viktor" page. Admin-only.
 *
 * The Viktor API key itself lives in VIKTOR_API_KEY (env var), matching how
 * every other agency-wide integration key is stored in this codebase
 * (SLACK_BOT_TOKEN, ANTHROPIC_API_KEY, CREDENTIALS_ENCRYPTION_KEY). The key
 * is generated in Viktor's own dashboard (Settings → API Keys → Generate Key)
 * and pasted into Vercel's environment variables — this page shows the
 * connection status and explains the setup, but never accepts the key here
 * (a paste-into-a-web-form flow would need DB storage + encryption for no
 * real benefit over the env var).
 */
export default async function AiAssistantSettingsPage() {
  const perms = await loadPermissions();
  if (!perms?.isAdmin) notFound();

  const connected = Boolean(process.env.VIKTOR_API_KEY);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary-accent text-white">
          <Sparkles className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">AI Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Connect Viktor — the app&apos;s built-in AI teammate. Once connected, admins can ask Viktor questions from
            the topbar.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Connection</CardTitle>
            {connected ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-status-success-foreground">
                <CheckCircle2 className="size-4" />
                Connected
              </span>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <XCircle className="mr-1 size-3.5" />
                Not connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {connected ? (
            <p className="text-muted-foreground">
              Viktor is wired in. Every admin sees an Ask Viktor button in the topbar.
            </p>
          ) : (
            <>
              <p>To connect Viktor, do this once:</p>
              <ol className="ml-4 list-decimal space-y-2 text-muted-foreground marker:text-foreground">
                <li>
                  Sign in at{" "}
                  <a
                    href="https://viktor.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    viktor.com
                    <ExternalLink className="size-3" />
                  </a>{" "}
                  and open Settings → API Keys. Click &quot;Generate Key&quot; and copy it.
                </li>
                <li>
                  In your{" "}
                  <a
                    href="https://vercel.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Vercel project
                    <ExternalLink className="size-3" />
                  </a>{" "}
                  → Settings → Environment Variables, add{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">VIKTOR_API_KEY</code> with the key you copied.
                  Apply it to Production, Preview, and Development.
                </li>
                <li>Redeploy the app (Vercel does this automatically on the next push).</li>
                <li>Refresh this page — it should read Connected.</li>
              </ol>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What Viktor can see</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            When someone asks Viktor a question, Viktor reads the app through a locked, read-only door. It can look at:
          </p>
          <ul className="grid grid-cols-1 gap-2 text-foreground sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-status-success-foreground" />
              Clients and their contact info
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-status-success-foreground" />
              Tasks, deadlines, assignees
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-status-success-foreground" />
              Projects and their current stage
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-status-success-foreground" />
              Direct mail campaigns
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-status-success-foreground" />
              Client notes and meeting notes
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-status-success-foreground" />
              Assets awaiting a decision
            </li>
          </ul>
          <Separator />
          <p className="text-muted-foreground">And explicitly cannot see:</p>
          <ul className="space-y-1.5 text-foreground">
            <li className="flex items-center gap-2">
              <XCircle className="size-4 text-status-danger-foreground" />
              The credentials vault (client passwords)
            </li>
            <li className="flex items-center gap-2">
              <XCircle className="size-4 text-status-danger-foreground" />
              Private tasks (visible only to their creator)
            </li>
            <li className="flex items-center gap-2">
              <XCircle className="size-4 text-status-danger-foreground" />
              HighLevel client texts and call recordings
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who can use it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            For now, the Ask Viktor button is admin-only. Each admin has their own private chat history — nobody sees
            anyone else&apos;s conversations.
          </p>
          <p>
            Opening it up to non-admin team members with a per-user permission is a straightforward follow-up when
            you&apos;re ready.
          </p>
          <Button variant="outline" size="sm" render={<Link href="/team" />}>
            Go to Team settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
