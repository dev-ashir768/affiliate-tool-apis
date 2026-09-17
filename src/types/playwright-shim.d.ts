declare module "playwright" {
  export const chromium: {
    launch: (opts?: { headless?: boolean }) => Promise<{
      newPage: () => Promise<{
        goto: (
          url: string,
          opts?: { waitUntil?: string; timeout?: number }
        ) => Promise<unknown>;
        title: () => Promise<string>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}
