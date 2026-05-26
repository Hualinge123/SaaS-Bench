import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function OAuthAuthTestPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') ?? '';
  const state = searchParams.get('state') ?? '';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.close();
    }, 10000);
    return () => window.clearTimeout(timer);
  }, []);

  function handleAuthorize() {
    const params = new URLSearchParams({ code, state });
    window.location.href = `/login/callback?${params.toString()}`;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-orange-500">
          开发调试页面
        </div>
        <h1 className="mb-6 text-center text-xl font-bold text-gray-800">模拟授权同意</h1>

        <div className="mb-4 space-y-2 break-all rounded-lg bg-gray-50 p-4 font-mono text-sm">
          <div>
            <span className="text-gray-500">code: </span>
            <span className="text-green-700">{code || '(空)'}</span>
          </div>
          <div>
            <span className="text-gray-500">state: </span>
            <span className="text-blue-700">{state || '(空)'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAuthorize}
          disabled={!code || !state}
          className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          触发授权回调
        </button>

        <p className="mt-4 text-center text-xs text-gray-400">此页面仅在 OAUTH_MOCK=true 时使用；10秒后将自动关闭本页签</p>
      </div>
    </div>
  );
}
