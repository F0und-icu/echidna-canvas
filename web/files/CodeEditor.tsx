import { useLayoutEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';

function language(path: string): Extension {
  const extension = path.split('.').at(-1)!.toLowerCase();
  if (extension === 'py') return python();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension))
    return javascript({
      typescript: ['ts', 'tsx'].includes(extension),
      jsx: ['jsx', 'tsx'].includes(extension),
    });
  if (extension === 'json') return json();
  if (['md', 'markdown'].includes(extension)) return markdown();
  if (extension === 'rs') return rust();
  return [];
}
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--ec-primary)', fontWeight: '600' },
  { tag: [tags.string, tags.regexp], color: 'var(--ec-green)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--ec-primary)' },
  { tag: [tags.comment, tags.meta], color: 'var(--ec-muted)', fontStyle: 'italic' },
  {
    tag: [tags.typeName, tags.className, tags.function(tags.variableName)],
    color: 'var(--ec-title)',
  },
  { tag: tags.heading, color: 'var(--ec-title)', fontWeight: '600' },
]);
const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--ec-text)',
    backgroundColor: 'var(--ec-paper)',
    fontSize: 'var(--file-font-size,15px)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.75',
  },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--ec-title)' },
  '.cm-line': { padding: '0 20px 0 12px' },
  '.cm-gutters': {
    backgroundColor: 'var(--ec-paper)',
    color: 'var(--ec-muted)',
    borderRight: '1px solid var(--ec-line)',
    padding: '0 8px 0 6px',
  },
  '.cm-activeLine,.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb,var(--ec-green) 7%,transparent)',
  },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb,var(--ec-green) 22%,transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ec-title)' },
  '.cm-panels': { backgroundColor: 'var(--ec-bg)', color: 'var(--ec-text)' },
});
export type EditorPosition = { line: number; column: number; lines: number };
export function CodeEditor({
  path,
  value,
  readOnly,
  wrap,
  onChange,
  onPosition,
  label = '文件编辑内容',
}: {
  path: string;
  value: string;
  readOnly: boolean;
  wrap: boolean;
  onChange?: (value: string) => void;
  onPosition?: (position: EditorPosition) => void;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const cache = useRef(new Map<string, EditorState>());
  const mode = useRef(new Compartment()),
    wrapping = useRef(new Compartment());
  const callbacks = useRef({ onChange, onPosition });
  callbacks.current = { onChange, onPosition };
  const syncing = useRef(false);
  useLayoutEffect(() => {
    const state =
      cache.current.get(path) ??
      EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          theme,
          syntaxHighlighting(colors),
          language(path),
          // Keep ordinary CRLF files in their convention; the default parser also reads mixed endings.
          ...(value.includes('\r\n') && !/[\r\n]/.test(value.replaceAll('\r\n', ''))
            ? [EditorState.lineSeparator.of('\r\n')]
            : []),
          mode.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-multiline': 'true',
            tabindex: '0',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callbacks.current.onChange?.(update.state.sliceDoc());
            if (update.docChanged || update.selectionSet) {
              const at = update.state.selection.main.head,
                line = update.state.doc.lineAt(at);
              callbacks.current.onPosition?.({
                line: line.number,
                column: at - line.from + 1,
                lines: update.state.doc.lines,
              });
            }
          }),
        ],
      });
    const editor = new EditorView({ state, parent: container.current! });
    view.current = editor;
    const at = editor.state.selection.main.head,
      line = editor.state.doc.lineAt(at);
    callbacks.current.onPosition?.({
      line: line.number,
      column: at - line.from + 1,
      lines: editor.state.doc.lines,
    });
    return () => {
      cache.current.set(path, editor.state);
      editor.destroy();
      view.current = null;
    };
  }, [path]);
  useLayoutEffect(() => {
    const editor = view.current!;
    editor.dispatch({
      effects: [
        mode.current.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
        wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []),
      ],
    });
  }, [path, readOnly, wrap]);
  useLayoutEffect(() => {
    const editor = view.current!;
    if (editor.state.sliceDoc() === value) return;
    syncing.current = true;
    try {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      syncing.current = false;
    }
  }, [path, value]);
  return <div className="file-code-editor" ref={container} data-readonly={readOnly} />;
}
