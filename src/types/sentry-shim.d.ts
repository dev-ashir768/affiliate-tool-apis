declare module "@sentry/node" {
  export function init(opts: {
    dsn: string;
    environment?: string;
    tracesSampleRate?: number;
  }): void;
}
