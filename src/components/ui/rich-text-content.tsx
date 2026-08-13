import { cn } from "@/lib/utils";

/**
 * Read-only render of a rich-text field's stored HTML (see RichTextEditor) —
 * same node-schema output, same `.rich-text` styling, just no live editor
 * instance. Checkboxes from checklist items render inert (see the
 * `.rich-text-view` CSS rule in globals.css).
 */
export function RichTextContent({ html, className }: { html: string; className?: string }) {
  return <div className={cn("rich-text rich-text-view", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
