/**
 * Next.js supplies `server-only` at build time; it is not installed for tsx tests.
 * Import this first in a test that renders a client component whose server
 * actions reach a server-only module, so the import resolves to an empty stub.
 */
import Module from "node:module";

const STUB = "\0server-only-stub";
const loader = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
  _cache: Record<string, unknown>;
};
const resolve = loader._resolveFilename;
loader._resolveFilename = function (request: string, ...rest: unknown[]) {
  return request === "server-only" ? STUB : resolve.call(this, request, ...rest);
};
loader._cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: {} };
