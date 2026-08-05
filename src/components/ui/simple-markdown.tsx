type Props = {
  text: string;
  className?: string;
};

// Renders the small markdown subset actually produced in this app (## headers,
// "-"/"*" bullet lists, blank-line paragraph breaks) as real elements instead of
// literal "##"/"-" characters — covers both free-typed Client Notes and the
// AI-generated Meeting Note summaries, which both use this same subset.
export function SimpleMarkdown({ text, className }: Props) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList(key: string) {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={key} className="list-disc space-y-0.5 pl-5">
          {listItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  }

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.startsWith("## ") || line.startsWith("# ")) {
      flushList(`list-${index}`);
      const heading = line.replace(/^#{1,2}\s+/, "");
      blocks.push(
        <p key={index} className="mt-3 font-semibold text-foreground first:mt-0">
          {heading}
        </p>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(line.slice(2));
    } else if (line === "") {
      flushList(`list-${index}`);
    } else {
      flushList(`list-${index}`);
      blocks.push(<p key={index}>{line}</p>);
    }
  });
  flushList("list-end");

  return <div className={className}>{blocks}</div>;
}
