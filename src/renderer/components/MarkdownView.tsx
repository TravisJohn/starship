import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type MarkdownViewProps = {
  children: string;
};

export const MarkdownView = ({ children }: MarkdownViewProps): JSX.Element => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
    {children}
  </ReactMarkdown>
);

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-1 text-lg font-semibold text-zinc-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 border-b border-zinc-800 pb-1 text-base font-semibold text-zinc-50">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-sm font-semibold text-zinc-100">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-sm leading-6 text-zinc-300">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-100">{children}</strong>
  ),
  em: ({ children }) => <em className="text-zinc-200">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} className="text-sky-300 underline hover:text-sky-200">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-zinc-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-sky-500/40 pl-3 text-sm italic text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-zinc-800" />,
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em] text-sky-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm text-zinc-300">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-zinc-700 text-zinc-100">{children}</thead>
  ),
  th: ({ children }) => <th className="px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }) => (
    <td className="border-t border-zinc-800 px-2 py-1 align-top">{children}</td>
  )
};
