"use client";

import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import {
  Bold as BoldIcon,
  Code2,
  Eraser,
  Italic as ItalicIcon,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { MentionList, type MentionItem, type MentionListHandle } from "@/components/ui/mention-list";

type Props = {
  content: string;
  onChange: (html: string) => void;
  teamMembers: MentionItem[];
  placeholder?: string;
  className?: string;
};

function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted",
        active && "bg-accent text-accent-foreground"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Rich-text editor for Task.description — bold/italic/underline/strike,
 * bulleted/numbered/checklist lists, quote, code, auto-linking URLs
 * (Tiptap's Link extension, bundled via StarterKit), and @mention
 * autocomplete against the real team member list. Stores its content as
 * HTML (Task.description stays a plain string column — see
 * src/lib/text-format.ts for how mentions/plain-text previews are derived
 * from it). No file/attachment support by design.
 */
export function RichTextEditor({ content, onChange, teamMembers, placeholder, className }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({ placeholder: placeholder ?? "Add more detail..." }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {
          // Default is `[" "]` — @tiptap/suggestion otherwise only opens the
          // dropdown when "@" is preceded by a space or starts the line,
          // which silently does nothing if typed after punctuation or
          // mid-sentence. Null disables that restriction entirely.
          allowedPrefixes: null,
          items: ({ query }: { query: string }): MentionItem[] =>
            teamMembers.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
          render: () => {
            let component: ReactRenderer<MentionListHandle, { items: MentionItem[]; command: (item: { id: string; label: string }) => void }>;
            let unmount: (() => void) | undefined;
            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, { props, editor: props.editor as unknown as Editor });
                unmount = props.mount(component.element as HTMLElement);
              },
              onUpdate(props) {
                component.updateProps(props);
              },
              onKeyDown(props) {
                if (props.event.key === "Escape") return true;
                return component.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                unmount?.();
                component.destroy();
              },
            };
          },
        },
      }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "rich-text min-h-32 px-3 py-2 focus:outline-none" },
    },
  });

  // Resyncs when a different task's content loads into the same mounted
  // editor instance — skipped when it already matches so this never fights
  // the user's own in-progress typing.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === content) return;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);

  if (!editor) return null;

  function setLink() {
    const previousUrl = editor!.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
        <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <BoldIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <ItalicIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="size-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <ListChecks className="size-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code2 className="size-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton label="Add link" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="size-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton label="Clear formatting" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
          <Eraser className="size-3.5" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
