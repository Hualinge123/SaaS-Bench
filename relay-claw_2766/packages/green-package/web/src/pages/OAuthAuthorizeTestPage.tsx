import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function OAuthAuthorizeTestPage() {
  const [searchParams] = useSearchParams();
  const state = searchParams.get('state') ?? '';
  const clientId = searchParams.get('client_id') ?? '';
  const codeChallenge = searchParams.get('code_challenge') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '/login/auth-test';
  const [loading, setLoading] = useState(false);

  function handleLogin() {
    if (!state) return;
    setLoading(true);
    const mockCode = `mock_code_${randomHex(16)}`;
    const params = new URLSearchParams({ code: mockCode, state });
    const callbackUrl = new URL(redirectUri, window.location.origin);
    callbackUrl.search = params.toString();
    window.location.replace(callbackUrl.toString());
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#cf0000]">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-orange-500">
          开发调试页面
        </div>
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-800">华为账号</h1>
        <p className="mb-6 text-center text-sm text-gray-500">模拟登录表单（OAUTH_MOCK=true）</p>

        <div className="mb-4 space-y-1 rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-500">
          <div>client_id: {clientId || '(未传入)'}</div>
          <div className="truncate">state: {state || '(未传入)'}</div>
          <div className="truncate">code_challenge: {codeChallenge.slice(0, 20)}...</div>
          <div className="truncate">redirect_uri: {redirectUri}</div>
        </div>

        <button
          type="button"
          onClick={handleLogin}
          disabled={!state || loading}
          className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
        >
          {loading ? '跳转中...' : '模拟登录'}
        </button>
      </div>
    </div>
  );
}
