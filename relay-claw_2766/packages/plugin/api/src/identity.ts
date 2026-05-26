/**
 * Gateway Identity — the minimal identity struct passed through the gateway pipeline.
 * Currently contains only userId; extensible for multi-tenant scenarios.
 */
export interface GatewayIdentity {
  userId: string;
}
