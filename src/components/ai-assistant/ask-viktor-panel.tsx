"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Clock, FileText, Loader2, Paperclip, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react";

import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";

type MessageAttachment = { name: string; sizeBytes: number };

type Message = {
  id: string;
  role: "user" | "assistant";
  body: string;
  attachments?: MessageAttachment[];
};

type ConversationListItem = {
  id: string;
  title: string | null;
  updatedAt: string;
  createdAt: string;
};

type PendingAttachment = { file: File; id: string };

const SUGGESTED_PROMPTS = [
  "What's overdue for Journey Smiles?",
  "Summarize this week's activity across all clients",
  "Which projects are stuck on the same stage?",
];

type View = "chat" | "history";

/**
 * The personal "Ask Viktor" panel — each user has their own conversation
 * history, scoped to their own user id at the API layer (see
 * src/app/api/ai-assistant/conversations/**). The panel opens showing the
 * most recent conversation, if any; the History view lists every past
 * chat.
 */
export function AskViktorPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<View>("chat");
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/ai-assistant/conversations");
    if (!res.ok) return [] as ConversationListItem[];
    const data = (await res.json()) as { conversations: ConversationListItem[] };
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-assistant/conversations/${id}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = (await res.json()) as {
        conversation: { id: string; messages: { id: string; role: string; body: string; attachmentsJson: unknown }[] };
      };
      setConversationId(data.conversation.id);
      setMessages(
        data.conversation.messages.map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          body: m.body,
          attachments: Array.isArray(m.attachmentsJson) ? (m.attachmentsJson as MessageAttachment[]) : undefined,
        }))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // On panel open, load the list; drop into the most recent if there is one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const list = await loadConversations();
      if (cancelled) return;
      if (list.length > 0 && !conversationId) {
        await loadConversation(list[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only rerun when the panel opens/closes — reloading on every id change
    // would cause a fetch loop after selecting from history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Autoscroll on new messages / while sending.
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, sending]);

  // Autosize textarea up to ~5 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  async function ensureConversationId(): Promise<string | null> {
    if (conversationId) return conversationId;
    const res = await fetch("/api/ai-assistant/conversations", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { conversation: { id: string } };
    setConversationId(data.conversation.id);
    return data.conversation.id;
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setPending([]);
    setView("chat");
  }

  async function selectConversation(id: string) {
    setView("chat");
    await loadConversation(id);
  }

  async function deleteConversation(id: string) {
    if (!confirm("Delete this chat? This can't be undone.")) return;
    const res = await fetch(`/api/ai-assistant/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setConversations((current) => current.filter((c) => c.id !== id));
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
    }
  }

  function handleFilePicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const additions: PendingAttachment[] = Array.from(files).map((file) => ({
      file,
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setPending((current) => [...current, ...additions]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePending(id: string) {
    setPending((current) => current.filter((p) => p.id !== id));
  }

  async function submit(overrideText?: string) {
    const question = (overrideText ?? input).trim();
    if (!question || sending) return;

    const id = await ensureConversationId();
    if (!id) {
      setMessages((current) => [
        ...current,
        { id: `err-${Date.now()}`, role: "assistant", body: "Couldn't start a conversation. Are you signed in?" },
      ]);
      return;
    }

    const attachments = pending.map((p) => ({ name: p.file.name, sizeBytes: p.file.size }));
    // Optimistic user message so the UI feels instant.
    const optimisticUserMsg: Message = {
      id: `u-optimistic-${Date.now()}`,
      role: "user",
      body: question,
      attachments,
    };
    setMessages((current) => [...current, optimisticUserMsg]);
    setInput("");
    setPending([]);
    setSending(true);

    try {
      const res = await fetch(`/api/ai-assistant/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: question, attachments }),
      });
      const data = (await res.json().catch(() => null)) as
        | { userMessage: { id: string }; assistantMessage: { id: string; body: string } }
        | { error?: string }
        | null;
      if (!res.ok || !data || !("assistantMessage" in data)) {
        const errMsg = (data && "error" in data && data.error) || "Something went wrong. Try again in a moment.";
        setMessages((current) => [
          ...current,
          { id: `err-${Date.now()}`, role: "assistant", body: errMsg },
        ]);
      } else {
        // Replace optimistic ids with server ids so future replays reconcile
        // cleanly. Assistant message is appended.
        setMessages((current) => [
          ...current.map((m) => (m.id === optimisticUserMsg.id ? { ...m, id: data.userMessage.id } : m)),
          { id: data.assistantMessage.id, role: "assistant", body: data.assistantMessage.body },
        ]);
        // Refresh the sidebar list so title / updatedAt reflect the new send.
        void loadConversations();
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: `err-${Date.now()}`, role: "assistant", body: error instanceof Error ? error.message : "Network error." },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md" showCloseButton={false}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {view === "history" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setView("chat")}
                title="Back to chat"
                aria-label="Back to chat"
              >
                <ChevronLeft className="size-4" />
              </Button>
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary-accent text-white">
                <Sparkles className="size-4" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{view === "history" ? "Your chats" : "Ask Viktor"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {view === "history"
                  ? `${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}`
                  : messages.length > 0
                  ? `${messages.length} messages`
                  : "Your AI teammate"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {view === "chat" ? (
              <>
                <Button variant="ghost" size="icon-sm" onClick={startNewChat} title="New chat" aria-label="New chat">
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setView("history")}
                  title="History"
                  aria-label="History"
                >
                  <Clock className="size-4" />
                </Button>
              </>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} title="Close" aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {view === "history" ? (
          <HistoryView
            conversations={conversations}
            currentId={conversationId}
            onSelect={selectConversation}
            onDelete={deleteConversation}
            onNew={() => {
              startNewChat();
            }}
          />
        ) : (
          <>
            {/* Messages / empty state */}
            <div ref={scrollerRef} className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
                  <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary-accent text-white">
                    <Sparkles className="size-7" />
                  </div>
                  <p className="text-lg font-semibold">How can I help?</p>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    I have access to your clients, tasks, projects, and notes. Ask me anything.
                  </p>
                  <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => submit(prompt)}
                        className="rounded-lg border border-border bg-transparent px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:border-primary hover:bg-primary/10"
                      >
                        <span className="mr-1.5 text-primary">▸</span>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-5 px-4 py-5">
                  {messages.map((msg) => (
                    <MessageRow key={msg.id} message={msg} />
                  ))}
                  {sending ? (
                    <div className="flex items-start gap-2.5">
                      <MessageAvatar role="assistant" />
                      <div className="flex items-center gap-1 py-1">
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:0s]" />
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:0.2s]" />
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:0.4s]" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t bg-card px-4 py-3">
              {pending.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pending.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-primary/10 px-2.5 py-1 text-xs"
                    >
                      <FileText className="size-3" />
                      <span className="max-w-[160px] truncate">{p.file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePending(p.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${p.file.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-2.5 py-2 focus-within:border-primary">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilePicked(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                  aria-label="Attach file"
                  title="Attach file"
                >
                  <Paperclip className="size-4" />
                </button>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="Ask Viktor anything about your work…"
                  className="flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!input.trim() || sending}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-primary-foreground transition-opacity",
                    !input.trim() || sending ? "cursor-not-allowed bg-primary/40" : "bg-primary hover:opacity-90"
                  )}
                  aria-label="Send"
                  title="Send"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Viktor can see clients, tasks, projects, and notes · never passwords or private tasks
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function HistoryView({
  conversations,
  currentId,
  onSelect,
  onDelete,
  onNew,
}: {
  conversations: ConversationListItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-3">
      <Button variant="outline" size="sm" onClick={onNew} className="mb-3 w-full justify-start">
        <Plus className="mr-1.5 size-4" />
        New chat
      </Button>
      {conversations.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {conversations.map((c) => {
            const isCurrent = c.id === currentId;
            return (
              <li key={c.id}>
                <div
                  className={cn(
                    "group flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                    isCurrent ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
                  )}
                >
                  <button type="button" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium">{c.title ?? "(Empty chat)"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(c.updatedAt)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-status-danger-foreground group-hover:opacity-100"
                    aria-label="Delete chat"
                    title="Delete chat"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-row-reverse items-start gap-2.5">
        <MessageAvatar role="user" />
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-muted px-3.5 py-2.5 text-sm">
          {message.attachments && message.attachments.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {message.attachments.map((a) => (
                <span
                  key={a.name}
                  className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/40 px-1.5 py-0.5 text-[11px]"
                >
                  <FileText className="size-3" />
                  {a.name}
                </span>
              ))}
            </div>
          ) : null}
          <p className="whitespace-pre-wrap">{message.body}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <MessageAvatar role="assistant" />
      <div className="max-w-[85%] text-sm leading-relaxed">
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
    </div>
  );
}

function MessageAvatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted-foreground/80 text-xs font-semibold text-white">
        You
      </div>
    );
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary-accent text-white">
      <Sparkles className="size-3.5" />
    </div>
  );
}
