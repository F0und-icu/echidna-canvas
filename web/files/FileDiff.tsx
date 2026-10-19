import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { fileDiff } from './diffLines';

export function FileDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
  wrap,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  wrap: boolean;
}) {
  const [full, setFull] = useState(false),
    [whitespace, setWhitespace] = useState(false),
    [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const diff = useMemo(() => fileDiff(before, after, full), [before, after, full]);
  const move = (direction: number) => {
    const next = (active + direction + diff.hunks.length) % diff.hunks.length;
    setActive(next);
    const target = scroller.current!.querySelectorAll<HTMLElement>('.file-diff-hunk')[next];
    scroller.current!.scrollTop = target.offsetTop - 40;
  };
  return (
    <section className="file-diff" aria-label="逐行修改差异">
      <header className="file-diff-heading">
        <div className="file-diff-labels">
          <span title={beforeLabel}>旧：{beforeLabel}</span>
          <span title={afterLabel}>新：{afterLabel}</span>
        </div>
        <div className="file-diff-summary" role="status">
          <span className="diff-added">+{diff.added} 行</span>
          <span className="diff-removed">−{diff.removed} 行</span>
          <span>{diff.hunks.length} 个差异片段</span>
        </div>
        <div className="file-diff-controls">
          <div>
            <button
              aria-pressed={full}
              onClick={() => {
                setFull(!full);
                setActive(0);
              }}
            >
              {full ? '仅看改动' : '显示全文'}
            </button>
            <button aria-pressed={whitespace} onClick={() => setWhitespace(!whitespace)}>
              显示空白
            </button>
          </div>
          <div>
            <button
              className="icon-button"
              aria-label="上一处差异"
              disabled={!diff.hunks.length}
              onClick={() => move(-1)}
            >
              <ArrowUp size={14} />
            </button>
            <small>
              {diff.hunks.length ? active + 1 : 0}/{diff.hunks.length}
            </small>
            <button
              className="icon-button"
              aria-label="下一处差异"
              disabled={!diff.hunks.length}
              onClick={() => move(1)}
            >
              <ArrowDown size={14} />
            </button>
          </div>
        </div>
      </header>
      {diff.hunks.length ? (
        <div ref={scroller} className="file-diff-body" tabIndex={0} data-wrap={wrap}>
          <table aria-label="旧行号、新行号与内容差异">
            <thead>
              <tr>
                <th>旧行</th>
                <th>新行</th>
                <th aria-label="变更类型" />
                <th>内容</th>
              </tr>
            </thead>
            {diff.hunks.map((hunk, index) => (
              <tbody key={index} className="file-diff-hunk" data-active={active === index}>
                <tr className="file-diff-range">
                  <td colSpan={4}>
                    @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                    {!full && ' · 省略未修改内容'}
                  </td>
                </tr>
                {hunk.lines.map((line, lineIndex) => (
                  <tr key={lineIndex} data-kind={line.kind}>
                    <td className="file-diff-number">{line.oldLine}</td>
                    <td className="file-diff-number">{line.newLine}</td>
                    <td
                      className="file-diff-sign"
                      aria-label={
                        line.kind === 'add' ? '新增' : line.kind === 'remove' ? '删除' : '未修改'
                      }
                    >
                      {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
                    </td>
                    <td className="file-diff-text">
                      <code>
                        {whitespace
                          ? line.text.replace(/ /g, '·').replace(/\t/g, '→   ').replace(/\r$/, ' ␍')
                          : line.text.replace(/\r$/, '')}
                      </code>
                      {line.noNewline && (
                        <small className="file-diff-no-newline">文件末尾无换行</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : full ? (
        <pre className="file-diff-unchanged" data-wrap={wrap}>
          {after || '（空文件）'}
        </pre>
      ) : (
        <p className="file-diff-identical">两个版本内容完全相同。</p>
      )}
    </section>
  );
}
