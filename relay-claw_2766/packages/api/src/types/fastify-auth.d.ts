import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUserId?: string | null;
  }
}
