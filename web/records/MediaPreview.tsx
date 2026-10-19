import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Globe, ImageOff, Maximize2, Minus, Plus, X } from 'lucide-react';
import type { ToolCall } from '../model/projection';
import { useDialogBackdrop } from '../app/useDialogBackdrop';

export function MediaPreview({
  preview,
  expanded = false,
}: {
  preview: NonNullable<ToolCall['previews']>[number];
  expanded?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState(false);
  if (preview.kind === 'webpage') {
    const url = new URL(preview.url);
    const topic = url.pathname.split('/').filter(Boolean).at(-1);
    const title = topic
      ? topic.replace(/\.(?:html?|aspx?)$/i, '').replace(/[_-]+/g, ' ')
      : url.hostname;
    return (
      <a
        className="web-preview"
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        title={preview.url}
        aria-label={`打开网页：${title}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="web-topic-mark">
          <Globe size={14} /> 网页 <ArrowUpRight size={12} />
        </span>
        <strong>{title}</strong>
        <span className="web-topic-site">{url.hostname}</span>
      </a>
    );
  }
  const src =
    '/api/runtime/image?event=' + encodeURIComponent(preview.eventId) + '&part=' + preview.part;
  return (
    <>
      <button
        className={`image-preview ${expanded ? 'expanded' : ''}`}
        type="button"
        onClick={() => setOpened(true)}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={'放大查看：' + preview.title}
      >
        {failed ? (
          <span className="preview-unavailable">
            <ImageOff size={22} />
            <small>图像无法预览</small>
          </span>
        ) : (
          <img src={src} alt={preview.title} loading="lazy" onError={() => setFailed(true)} />
        )}
        <Maximize2 className="image-expand-mark" size={13} />
      </button>
      {opened && (
        <ImageViewer
          src={src}
          title={preview.title}
          onLoaded={() => setFailed(false)}
          onClose={() => setOpened(false)}
        />
      )}
    </>
  );
}

function ImageViewer({
  src,
  title,
  onLoaded,
  onClose,
}: {
  src: string;
  title: string;
  onLoaded: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useDialogBackdrop(() => dialog.current!.close());
  const [zoom, setZoom] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Load once as a blob so an unavailable source can display its actual error.
    let objectUrl: string;
    void fetch(src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error);
        objectUrl = URL.createObjectURL(await response.blob());
        setImage(objectUrl);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  const [image, setImage] = useState('');
  return createPortal(
    <dialog
      ref={dialog}
      className="media-viewer"
      aria-label={title}
      onClose={onClose}
      onClick={backdrop.onClick}
      onPointerDown={backdrop.onPointerDown}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="media-viewer-shell">
        <header>
          <strong>{title}</strong>
          <div className="media-viewer-controls">
            <button aria-label="缩小图片" onClick={() => setZoom(Math.max(25, (zoom ?? 100) - 25))}>
              <Minus size={16} />
            </button>
            <button onClick={() => setZoom(zoom === null ? 100 : null)}>
              {zoom === null ? '原始尺寸' : `${zoom}% · 适应窗口`}
            </button>
            <button
              aria-label="放大图片"
              onClick={() => setZoom(Math.min(400, (zoom ?? 100) + 25))}
            >
              <Plus size={16} />
            </button>
            <a href={src} target="_blank" rel="noopener noreferrer">
              打开原图 <ArrowUpRight size={14} />
            </a>
            <button aria-label="关闭图片预览" onClick={() => dialog.current!.close()}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div className={`media-viewer-content ${zoom === null ? 'fit' : ''}`}>
          {error ? (
            <p role="alert">
              <ImageOff size={24} />
              {error}
            </p>
          ) : image ? (
            <img
              src={image}
              alt={title}
              style={zoom === null ? undefined : { zoom: zoom / 100 }}
              onLoad={onLoaded}
              onError={() => setError('浏览器无法解码这张图像。')}
            />
          ) : (
            <p role="status">正在读取图像…</p>
          )}
        </div>
      </div>
    </dialog>,
    document.querySelector('.echidna-app')!,
  );
}
