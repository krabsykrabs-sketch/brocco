"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown rendering for Brocco's messages, styled to match the chat bubbles.
 * Opus writes bullets, bold, tables and headers — without this users see the
 * raw `**` and `-` characters.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-ink leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1.5 pl-4 space-y-0.5 list-disc marker:text-sage">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 pl-4 space-y-0.5 list-decimal marker:text-sage">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
          h1: ({ children }) => <p className="mt-3 mb-1 font-extrabold text-ink">{children}</p>,
          h2: ({ children }) => <p className="mt-3 mb-1 font-extrabold text-ink">{children}</p>,
          h3: ({ children }) => <p className="mt-2.5 mb-1 font-bold text-ink">{children}</p>,
          h4: ({ children }) => <p className="mt-2 mb-1 font-bold text-ink">{children}</p>,
          code: ({ children, className }) =>
            className?.includes("language-") ? (
              <code className="block bg-ghost border border-shade rounded-lg px-3 py-2 my-1.5 text-xs font-mono text-ink overflow-x-auto">
                {children}
              </code>
            ) : (
              <code className="bg-ghost rounded px-1 py-0.5 text-xs font-mono text-ink">{children}</code>
            ),
          pre: ({ children }) => <pre className="my-0">{children}</pre>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-leaf underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-shade pl-3 my-1.5 text-moss">{children}</blockquote>
          ),
          hr: () => <hr className="my-2 border-shade" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-1.5">
              <table className="text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-shade px-2 py-1 text-left font-bold text-ink bg-ghost">{children}</th>
          ),
          td: ({ children }) => <td className="border border-shade px-2 py-1 text-ink">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
