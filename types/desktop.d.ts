export {};

declare global {
  interface Window {
    desktopApi?: {
      pickDownloadDirectory?: () => Promise<string | null>;
      bilibiliLoginAndGetCookie?: () => Promise<{
        cookie: string;
        cookieKeys: string[];
        source: string;
      }>;
      getBilibiliCookieSnapshot?: () => Promise<{
        cookie: string;
        cookieKeys: string[];
        hasRequired: boolean;
      }>;
      clearBilibiliCookies?: () => Promise<{
        removed: number;
        hasRequired: boolean;
      }>;
    };
  }
}
