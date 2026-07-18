import type { Bindings } from "../src/env";

declare global {
  namespace Cloudflare {
    // Declaration merging requires an interface for the test runtime environment.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends Bindings {}
  }
}

export {};
