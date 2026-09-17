declare module "playwright" {
  export const chromium: {
    launch: (opts?: { headless?: boolean }) => Promise<{
      newContext: () => Promise<{
        newPage: () => Promise<{
          goto: (
            url: string,
            opts?: { waitUntil?: string; timeout?: number }
          ) => Promise<unknown>;
          click: (selector: string, opts?: { timeout?: number }) => Promise<void>;
          waitForSelector: (
            selector: string,
            opts?: { timeout?: number }
          ) => Promise<unknown>;
          evaluate: <T>(fn: () => T) => Promise<T>;
          title: () => Promise<string>;
          close: () => Promise<void>;
        }>;
        storageState: () => Promise<unknown>;
        close: () => Promise<void>;
      }>;
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
