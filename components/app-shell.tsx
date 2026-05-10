"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { ActionBar } from "@/components/action-bar";
import { CookiePanel } from "@/components/cookie-panel";
import { DownloadSettingsPanel } from "@/components/download-settings-panel";
import { LogPanel } from "@/components/log-panel";
import { SearchFilterPanel } from "@/components/search-filter-panel";
import { SongInputPanel } from "@/components/song-input-panel";
import { TaskStatusPanel } from "@/components/task-status-panel";
import { Form } from "@/components/ui/form";
import { useCookieStatus } from "@/hooks/use-cookie-status";
import { useDownloadTask } from "@/hooks/use-download-task";
import {
  downloadFormDefaults,
  downloadFormSchema,
  type DownloadFormInput,
  type DownloadFormValues,
} from "@/lib/schema";
import type { JobLog } from "@/lib/types";

const COOKIE_STORAGE_KEY = "bbdown.music.cookie.v2";

export function AppShell() {
  const form = useForm<DownloadFormInput, unknown, DownloadFormValues>({
    resolver: zodResolver(downloadFormSchema),
    defaultValues: downloadFormDefaults,
    mode: "onBlur",
  });

  const [logHidden, setLogHidden] = useState(false);

  const { currentJobId, healthQuery, task, taskQuery, progress, isBusy, isRunning, startTask, createError, taskError } =
    useDownloadTask();
  const cookieValue = useWatch({
    control: form.control,
    name: "cookie",
  });

  const cookieStatus = useCookieStatus({
    getCookie: () => form.getValues("cookie") ?? "",
    setCookie: (value) => form.setValue("cookie", value, { shouldDirty: true }),
  });

  useEffect(() => {
    const defaultDir = healthQuery.data?.defaultOutputDir;
    if (!defaultDir) return;
    const currentDir = String(form.getValues("outputDir") ?? "").trim();
    if (currentDir.length > 0) return;
    form.setValue("outputDir", defaultDir, { shouldDirty: false });
  }, [form, healthQuery.data?.defaultOutputDir]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(COOKIE_STORAGE_KEY);
    if (saved && !(form.getValues("cookie") ?? "")) {
      form.setValue("cookie", saved, { shouldDirty: false });
    }
  }, [form]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cookie = String(cookieValue || "").trim();
    if (cookie) {
      window.localStorage.setItem(COOKIE_STORAGE_KEY, cookie);
    } else {
      window.localStorage.removeItem(COOKIE_STORAGE_KEY);
    }
  }, [cookieValue]);

  useEffect(() => {
    void (async () => {
      await cookieStatus.hydrateCookieFromDesktop().catch(() => undefined);
      await cookieStatus.inspectCurrentCookie(false).catch(() => undefined);
    })();
    // 仅在首次进入页面时尝试回填/检查 Cookie，避免重复触发请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickOutputDir = async () => {
    if (typeof window === "undefined") return;
    if (!window.desktopApi?.pickDownloadDirectory) return;
    const picked = await window.desktopApi.pickDownloadDirectory();
    if (!picked) return;
    form.setValue("outputDir", picked, { shouldDirty: true });
  };

  const onSubmit = async (values: DownloadFormValues) => {
    setLogHidden(false);
    await startTask(values);
  };

  const displayLogs: JobLog[] = useMemo(() => {
    if (logHidden) return [];
    return task?.logs ?? [];
  }, [logHidden, task?.logs]);

  const taskErrors = useMemo(() => {
    const errors: string[] = [];
    if (createError instanceof Error) errors.push(createError.message);
    if (taskError instanceof Error) errors.push(taskError.message);
    return errors;
  }, [createError, taskError]);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">BBDown 音乐批量下载器</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          批量输入歌名，自动检索 B 站并下载音频。前端已重构为 Next.js + TypeScript + Tailwind + shadcn/ui。
        </p>
      </header>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 xl:grid-cols-[minmax(620px,1fr)_minmax(520px,640px)]">
          <section className="space-y-4">
            <SongInputPanel form={form} disabled={isBusy} />
            <DownloadSettingsPanel form={form} disabled={isBusy} onPickOutputDir={onPickOutputDir} />
            <SearchFilterPanel form={form} disabled={isBusy} />
            <CookiePanel
              form={form}
              disabled={isBusy}
              busy={cookieStatus.isBusy}
              notice={cookieStatus.notice.message}
              noticeClassName={cookieStatus.noticeClassName}
              desktopLoginSupported={cookieStatus.desktopLoginSupported}
              onDesktopLogin={cookieStatus.triggerDesktopLogin}
              onInspect={() => cookieStatus.inspectCurrentCookie(true)}
              onClear={cookieStatus.clearCookie}
            />
            <ActionBar health={healthQuery.data} isBusy={isBusy} isRunning={isRunning} />
          </section>

          <section className="space-y-4">
            <TaskStatusPanel currentJobId={currentJobId} task={task} progress={progress} errors={taskErrors} />
            <LogPanel logs={displayLogs} onClear={() => setLogHidden(true)} />
            {taskQuery.isFetching && isRunning ? (
              <p className="text-xs text-muted-foreground">状态刷新中...</p>
            ) : null}
          </section>
        </form>
      </Form>
    </main>
  );
}
