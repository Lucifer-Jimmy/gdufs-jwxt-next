declare global {
  namespace Cloudflare {
    // The Workers test pool requires declaration merging with its Env interface.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends Bindings {}
  }
}

export {};
