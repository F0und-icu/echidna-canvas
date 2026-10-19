import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo } from 'react';
import { ArrowUpRight, MessageCircle } from 'lucide-react';

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || '查看图片'} ↗
      </a>
    ) : (
      <span>{alt}</span>
    ),
  table: ({ children }) => (
    <div className="markdown-table" tabIndex={0} aria-label="表格，可横向滚动">
      <table>{children}</table>
    </div>
  ),
};
const plugins = [remarkGfm];

export const MarkdownReply = memo(function MarkdownReply({ text }: { text: string }) {
  return (
    <div className="markdown-reply">
      <Markdown remarkPlugins={plugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
});

export function ReplyCard({
  text,
  fixture = false,
  onInspect,
}: {
  text: string;
  fixture?: boolean;
  onInspect: () => void;
}) {
  return (
    <article className="reply-card">
      <small>
        <MessageCircle size={12} /> {fixture ? '示例回复' : '回复'}
      </small>
      <div className="reply-card-excerpt">
        <MarkdownReply text={text} />
      </div>
      <button className="reply-open" onClick={onInspect} aria-label="回复：对话记录">
        展开回复 <ArrowUpRight size={12} />
      </button>
    </article>
  );
}
