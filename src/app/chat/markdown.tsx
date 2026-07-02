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
    <div className="text-sm text-gray-200 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1.5 pl-4 space-y-0.5 list-disc marker:text-gray-600">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 pl-4 space-y-0.5 list-decimal marker:text-gray-600">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
          h1: ({ children }) => <p className="mt-3 mb-1 font-bold text-white">{children}</p>,
          h2: ({ children }) => <p className="mt-3 mb-1 font-bold text-white">{children}</p>,
          h3: ({ children }) => <p className="mt-2.5 mb-1 font-semibold text-white">{children}</p>,
          h4: ({ children }) => <p className="mt-2 mb-1 font-semibold text-gray-100">{children}</p>,
          code: ({ children, className }) =>
            className?.includes("language-") ? (
              <code className="block bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 my-1.5 text-xs font-mono overflow-x-auto">
                {children}
              </code>
            ) : (
              <code className="bg-gray-800 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
            ),
          pre: ({ children }) => <pre className="my-0">{children}</pre>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-green-400 underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-gray-700 pl-3 my-1.5 text-gray-400">{children}</blockquote>
          ),
          hr: () => <hr className="my-2 border-gray-800" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-1.5">
              <table className="text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-800 px-2 py-1 text-left font-semibold text-gray-300 bg-gray-950/60">{children}</th>
          ),
          td: ({ children }) => <td className="border border-gray-800 px-2 py-1 text-gray-300">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
