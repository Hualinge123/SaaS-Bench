import { Agent } from 'undici';

function resolveAuthFlowTlsRejectUnauthorized(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  return true;
}

let insecureAuthFlowAgent: Agent | null = null;

export function isAuthFlowTlsRejectUnauthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAuthFlowTlsRejectUnauthorized(env.OAUTH_TLS_REJECT_UNAUTHORIZED);
}

export function getAuthFlowTlsFetchOptions(env: NodeJS.ProcessEnv = process.env): RequestInit {
  if (isAuthFlowTlsRejectUnauthorized(env)) {
    return {};
  }

  if (!insecureAuthFlowAgent) {
    insecureAuthFlowAgent = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });
  }

  return {
    dispatcher: insecureAuthFlowAgent,
  } as unknown as RequestInit;
}
