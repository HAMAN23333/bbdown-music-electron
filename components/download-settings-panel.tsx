"use client";

import { Info } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import type { DownloadFormInput, DownloadFormValues } from "@/lib/schema";
import { BITRATE_DISABLED_FORMATS } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface DownloadSettingsPanelProps {
  form: UseFormReturn<DownloadFormInput, unknown, DownloadFormValues>;
  disabled?: boolean;
  onPickOutputDir: () => Promise<void>;
}

export function DownloadSettingsPanel({ form, disabled, onPickOutputDir }: DownloadSettingsPanelProps) {
  const format = form.watch("audioFormat") ?? "mp3";
  const bitrateDisabled = BITRATE_DISABLED_FORMATS.has(format);

  return (
    <Card>
      <CardHeader>
        <CardTitle>下载设置</CardTitle>
        <CardDescription>配置输出目录、并发和音频格式。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="outputDir"
          render={({ field }) => (
            <FormItem>
              <FormLabel>下载目录</FormLabel>
              <div className="flex gap-2">
                <FormControl>
                  <Input {...field} disabled={disabled} placeholder="默认：用户主目录" />
                </FormControl>
                <Button type="button" variant="secondary" onClick={() => void onPickOutputDir()} disabled={disabled}>
                  选择
                </Button>
              </div>
              <FormDescription>可输入绝对路径，也可使用系统目录选择器。</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="maxConcurrent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>并发数量</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    disabled={disabled}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                </FormControl>
                <FormDescription>范围 1-8，默认 2。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="audioFormat"
            render={({ field }) => (
              <FormItem>
                <FormLabel>输出格式</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="mp3">mp3（推荐）</SelectItem>
                    <SelectItem value="m4a">m4a</SelectItem>
                    <SelectItem value="aac">aac</SelectItem>
                    <SelectItem value="flac">flac（无损）</SelectItem>
                    <SelectItem value="wav">wav（无损）</SelectItem>
                    <SelectItem value="ogg">ogg</SelectItem>
                    <SelectItem value="opus">opus</SelectItem>
                    <SelectItem value="original">original（保持原始）</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="audioBitrateKbps"
          render={({ field }) => (
            <FormItem>
              <div className="mb-1 flex items-center gap-2">
                <FormLabel>音频比特率（kbps）</FormLabel>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>无损格式和 original 将忽略比特率。</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <FormControl>
                <Input
                  type="number"
                  min={64}
                  max={320}
                  disabled={disabled || bitrateDisabled}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                />
              </FormControl>
              <FormDescription>推荐 192 或 320。</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
