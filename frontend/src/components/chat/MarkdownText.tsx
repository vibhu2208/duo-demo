/** Lightweight markdown-ish rendering for assistant messages */
export function MarkdownText({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h4 key={i} className="font-semibold text-foreground mt-3 first:mt-0">
              {formatInline(line.slice(3))}
            </h4>
          );
        }
        if (line.startsWith('### ')) {
          return (
            <h5 key={i} className="font-medium text-foreground">
              {formatInline(line.slice(4))}
            </h5>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          return (
            <p key={i} className="pl-4 text-muted-foreground">
              {formatInline(line)}
            </p>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return (
          <p key={i} className="text-foreground/90">
            {formatInline(line)}
          </p>
        );
      })}
    </div>
  );
}

function formatInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}
