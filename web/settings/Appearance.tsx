import { useApp } from '../app/context';
import { themes, updateCanvas } from '../model/workspace';

const colorNames = [
  '画布',
  '纸面',
  '标题',
  '正文',
  '辅助文字',
  '主强调',
  '次强调',
  '分隔线',
  '代码背景',
];
export function Appearance() {
  const { workspace, canvas, setWorkspace } = useApp();
  return (
    <div className="stack">
      <fieldset>
        <legend>配色主题</legend>
        <div className="theme-list">
          {Object.entries(themes).map(([id, theme]) => (
            <button
              key={id}
              aria-pressed={workspace.appearance.theme === id}
              onClick={() =>
                setWorkspace((w) => ({
                  ...w,
                  appearance: {
                    ...w.appearance,
                    theme: id as keyof typeof themes,
                    colors: [...theme.colors],
                  },
                }))
              }
            >
              {theme.name}
              <span className="swatches">
                {[0, 5, 6].map((i) => (
                  <i key={i} style={{ background: theme.colors[i] }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <details>
        <summary>自定义九色</summary>
        <div className="custom-colors">
          {colorNames.map((name, i) => (
            <label key={name}>
              {name}
              <input
                type="color"
                aria-label={name + '颜色'}
                value={workspace.appearance.colors[i]}
                onChange={(e) =>
                  setWorkspace((w) => ({
                    ...w,
                    appearance: {
                      ...w.appearance,
                      theme: 'custom',
                      colors: w.appearance.colors.map((color, index) =>
                        index === i ? e.target.value : color,
                      ),
                    },
                  }))
                }
              />
              <code>{workspace.appearance.colors[i]}</code>
            </label>
          ))}
        </div>
      </details>
      <label>
        画布底纹
        <select
          value={canvas.paper}
          onChange={(e) =>
            setWorkspace((w) =>
              updateCanvas(w, (c) => ({ ...c, paper: e.target.value as typeof c.paper })),
            )
          }
        >
          <option value="plain">空白纸</option>
          <option value="dots">点阵纸</option>
          <option value="grid">方格纸</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={workspace.appearance.motion}
          onChange={(e) =>
            setWorkspace((w) => ({
              ...w,
              appearance: { ...w.appearance, motion: e.target.checked },
            }))
          }
        />
        角色动画
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={workspace.appearance.flowCharacters}
          onChange={(e) =>
            setWorkspace((w) => ({
              ...w,
              appearance: { ...w.appearance, flowCharacters: e.target.checked },
            }))
          }
        />
        流程中的动作形象
      </label>
      <small>系统“减少动态效果”优先于角色动画设置。</small>
    </div>
  );
}
