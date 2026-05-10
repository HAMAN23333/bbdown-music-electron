"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import type { DownloadFormInput, DownloadFormValues } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface CookiePanelProps {
  form: UseFormReturn<DownloadFormInput, unknown, DownloadFormValues>;
  disabled?: boolean;
  busy?: boolean;
  notice: string;
  noticeClassName: string;
  desktopLoginSupported: boolean;
  onDesktopLogin: () => Promise<void>;
  onInspect: () => Promise<void>;
  onClear: () => Promise<void>;
}

export function CookiePanel({
  form,
  disabled,
  busy,
  notice,
  noticeClassName,
  desktopLoginSupported,
  onDesktopLogin,
  onInspect,
  onClear,
}: CookiePanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const actionDisabled = Boolean(disabled || busy);

  return (
    <Card>
      <CardHeader>
        <CardTitle>账号 / Cookie</CardTitle>
        <CardDescription>会员或受限内容通常需要有效 Cookie。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs defaultValue="manual">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">手动输入</TabsTrigger>
            <TabsTrigger value="auto">自动登录</TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="space-y-3">
            <FormField
              control={form.control}
              name="cookie"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cookie 文本</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      className="console-text min-h-28 resize-y text-xs"
                      disabled={actionDisabled}
                      placeholder="SESSDATA=...; bili_jct=...; DedeUserID=...;"
                    />
                  </FormControl>
                  <FormDescription>会自动保存到本地，重开页面后继续可用。</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>
          <TabsContent value="auto" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              使用 Electron 内置窗口打开 B 站登录页，支持扫码或账号密码。登录后会自动回填 Cookie。
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={actionDisabled || !desktopLoginSupported}
              onClick={() => void onDesktopLogin()}
              className="w-full"
            >
              内置登录（扫码 / 账号密码）
            </Button>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={actionDisabled} onClick={() => void onInspect()}>
            检查 Cookie
          </Button>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" disabled={actionDisabled}>
                清空 Cookie
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认清空 Cookie？</DialogTitle>
                <DialogDescription>将移除当前输入框中的 Cookie，并尝试清理内置会话。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={async () => {
                    await onClear();
                    setDialogOpen(false);
                  }}
                >
                  确认清空
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <p className={`text-sm ${noticeClassName}`}>{notice}</p>
      </CardContent>
    </Card>
  );
}
