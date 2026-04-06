// src/components/Markdown.tsx — Shared markdown renderer
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const components: Components = {
  // Headings — explicit sizes so the typography plugin can't shrink them
  h1({ children }) {
    return <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-3 leading-tight border-b border-gray-200 pb-1">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-xl font-bold text-gray-900 mt-5 mb-2 leading-snug">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-1.5 leading-snug">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="text-base font-semibold text-gray-800 mt-3 mb-1">{children}</h4>;
  },
  h5({ children }) {
    return <h5 className="text-sm font-semibold text-gray-700 mt-2 mb-1">{children}</h5>;
  },
  // Tables — wrap for horizontal scroll, explicit cell borders
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-gray-100">{children}</thead>;
  },
  th({ children }) {
    return (
      <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border border-gray-300 px-3 py-2 text-sm text-gray-700 align-top">
        {children}
      </td>
    );
  },
  tr({ children }) {
    return <tr className="odd:bg-white even:bg-gray-50">{children}</tr>;
  },
  // Code blocks
  pre({ children }) {
    return (
      <pre className="bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto text-xs my-3">
        {children}
      </pre>
    );
  },
  code({ children, className }) {
    const isBlock = !!className;
    return isBlock ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="bg-gray-100 rounded px-1 py-0.5 text-xs font-mono text-gray-800">
        {children}
      </code>
    );
  },
};

interface MarkdownProps {
  children: string;
  /** Pass 'compact' inside tight card columns, default for full-width */
  size?: 'default' | 'compact';
}

export function Markdown({ children, size = 'default' }: MarkdownProps) {
  const base = size === 'compact'
    ? 'prose prose-sm max-w-none text-gray-800 prose-p:my-1 prose-li:my-0.5 prose-ul:my-1.5 prose-ol:my-1.5'
    : 'prose max-w-none text-gray-800 prose-p:my-2 prose-li:my-1 prose-ul:my-2 prose-ol:my-2';

  return (
    <div className={`
      ${base}
      prose-strong:font-semibold prose-strong:text-gray-900
      prose-a:text-blue-600 prose-a:underline
      prose-blockquote:border-l-4 prose-blockquote:border-brand-300 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600
      prose-hr:border-gray-200
    `}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
