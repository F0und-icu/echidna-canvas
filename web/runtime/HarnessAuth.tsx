import { useState } from 'react';
import { ExternalLink, KeyRound, Monitor, Smartphone } from 'lucide-react';
import type { HarnessLogin, LoginResult } from '../../contracts/runtime';
import type { RuntimeConnection } from './useRuntime';

const methods = {
  browser: { label: '浏览器登录', icon: <Monitor size={18} /> },
  'device-code': { label: '设备码', icon: <Smartphone size={18} /> },
  'api-key': { label: 'API Key', icon: <KeyRound size={18} /> },
};

export function HarnessAuth({
  runtime,
  disabled = false,
}: {
  runtime: RuntimeConnection;
  disabled?: boolean;
}) {
  const [method, setMethod] = useState<HarnessLogin['method']>('browser');
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LoginResult | null>(null),
    [error, setError] = useState('');
  const auth = runtime.backend?.authentication;
  if (!auth) return null;
  const begin = async () => {
    const request: HarnessLogin = method === 'api-key' ? { method, apiKey: key } : { method };
    setKey('');
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await runtime.login(request);
      setResult(response);
      if ('type' in response) await runtime.refreshBackend();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="harness-auth"
      open={runtime.backend?.account === 'signed-out' ? true : undefined}
    >
      <summary>
        认证方式{' '}
        <span>
          {runtime.backend?.account === 'signed-out'
            ? '尚未登录'
            : auth.activeMethod === 'api-key'
              ? 'API Key'
              : 'ChatGPT'}
        </span>
      </summary>
      <div className="stack">
        <div className="auth-methods" role="group" aria-label="认证方式">
          {auth.methods.map((id) => (
            <button
              type="button"
              key={id}
              aria-pressed={id === method}
              disabled={disabled || busy}
              onClick={() => {
                setMethod(id);
                setKey('');
                setResult(null);
                setError('');
              }}
            >
              {methods[id].icon}
              <span>{methods[id].label}</span>
            </button>
          ))}
        </div>
        {method === 'api-key' && (
          <label>
            OpenAI API Key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="OpenAI API Key"
              value={key}
              disabled={disabled || busy}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (key.trim()) void begin();
                }
              }}
            />
          </label>
        )}
        <p className="fine-print">
          认证用于本地 Codex 接入。密钥交给 Codex 保存，不进入画布或导出。
        </p>
        <button
          type="button"
          disabled={disabled || busy || (method === 'api-key' && !key.trim())}
          onClick={() => void begin()}
        >
          {busy
            ? '正在连接…'
            : method === 'api-key'
              ? '使用 API Key 认证'
              : `开始${methods[method].label}`}
        </button>
        {error && <p role="alert">{error}</p>}
        {result &&
          ('url' in result ? (
            <div className="login-result">
              {result.userCode && <strong className="device-code">{result.userCode}</strong>}
              <a href={result.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> 在浏览器完成授权
              </a>
              <button type="button" onClick={() => void runtime.refreshBackend()}>
                已完成，刷新账户与模型
              </button>
            </div>
          ) : (
            <p role="status">API Key 已交给本地 Codex，账户状态以当前返回为准。</p>
          ))}
      </div>
    </details>
  );
}
