"use client";

import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { inspectCookie } from "@/services/download-service";

type NoticeTone = "default" | "success" | "error";

interface NoticeState {
  tone: NoticeTone;
  message: string;
}

interface UseCookieStatusOptions {
  getCookie: () => string;
  setCookie: (value: string) => void;
}

export function useCookieStatus({ getCookie, setCookie }: UseCookieStatusOptions) {
  const desktopApi = typeof window === "undefined" ? undefined : window.desktopApi;

  const [notice, setNotice] = useState<NoticeState>({
    tone: "default",
    message: "可手动输入，或使用内置登录自动获取 Cookie。",
  });

  const inspectMutation = useMutation({
    mutationFn: ({ cookie, apply }: { cookie: string; apply: boolean }) => inspectCookie(cookie, apply),
    onSuccess: (data) => {
      if (data.hasRequired) {
        setNotice({
          tone: "success",
          message: "Cookie 已包含 SESSDATA / bili_jct / DedeUserID。",
        });
      } else {
        setNotice({
          tone: "error",
          message: `Cookie 不完整，缺少：${data.missingKeys.join(", ")}`,
        });
      }
    },
    onError: (err) => {
      setNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "Cookie 检查失败",
      });
    },
  });

  const loginMutation = useMutation({
    mutationFn: async () => {
      if (!desktopApi?.bilibiliLoginAndGetCookie) {
        throw new Error("当前运行环境不支持内置登录，请手动粘贴 Cookie。");
      }
      const result = await desktopApi.bilibiliLoginAndGetCookie();
      if (!result.cookie) {
        throw new Error("登录完成但未获取到有效 Cookie。");
      }
      return result;
    },
    onSuccess: async (result) => {
      setCookie(result.cookie);
      setNotice({
        tone: "success",
        message: `登录成功，已获取 ${result.cookieKeys.length} 个 Cookie 键。`,
      });
      await inspectMutation.mutateAsync({ cookie: result.cookie, apply: true });
    },
    onError: (err) => {
      setNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "自动登录失败",
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      setCookie("");
      let append = "";
      if (desktopApi?.clearBilibiliCookies) {
        const result = await desktopApi.clearBilibiliCookies();
        append = ` 已清理内置会话 Cookie ${result.removed} 个。`;
      }
      return append;
    },
    onSuccess: (append) => {
      setNotice({
        tone: "default",
        message: `已清空 Cookie。${append}`,
      });
    },
    onError: (err) => {
      setNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "清理 Cookie 失败",
      });
    },
  });

  const inspectCurrentCookie = useCallback(async (apply = true) => {
    const cookie = getCookie().trim();
    if (!cookie) {
      setNotice({
        tone: "default",
        message: "当前未填写 Cookie。可手动输入，或使用内置登录自动获取。",
      });
      return;
    }
    await inspectMutation.mutateAsync({ cookie, apply });
  }, [getCookie, inspectMutation]);

  const hydrateCookieFromDesktop = useCallback(async () => {
    if (!desktopApi?.getBilibiliCookieSnapshot) return;
    const current = getCookie().trim();
    if (current) return;

    const snapshot = await desktopApi.getBilibiliCookieSnapshot();
    if (snapshot.hasRequired && snapshot.cookie) {
      setCookie(snapshot.cookie);
      setNotice({
        tone: "success",
        message: "检测到已登录的内置会话，已自动回填 Cookie。",
      });
    }
  }, [desktopApi, getCookie, setCookie]);

  const isBusy = loginMutation.isPending || inspectMutation.isPending || clearMutation.isPending;
  const desktopLoginSupported = Boolean(desktopApi?.bilibiliLoginAndGetCookie);

  const noticeClassName = useMemo(() => {
    if (notice.tone === "success") return "text-emerald-700";
    if (notice.tone === "error") return "text-destructive";
    return "text-muted-foreground";
  }, [notice.tone]);

  const triggerDesktopLogin = useCallback(async () => {
    await loginMutation.mutateAsync();
  }, [loginMutation]);

  const clearCookie = useCallback(async () => {
    await clearMutation.mutateAsync();
  }, [clearMutation]);

  return {
    notice,
    noticeClassName,
    isBusy,
    desktopLoginSupported,
    inspectCurrentCookie,
    hydrateCookieFromDesktop,
    triggerDesktopLogin,
    clearCookie,
  };
}
