"use client";

import type { UseFormReturn } from "react-hook-form";

import type { DownloadFormInput, DownloadFormValues } from "@/lib/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

interface SongInputPanelProps {
  form: UseFormReturn<DownloadFormInput, unknown, DownloadFormValues>;
  disabled?: boolean;
}

export function SongInputPanel({ form, disabled }: SongInputPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>歌曲列表</CardTitle>
        <CardDescription>每行一首，建议“歌名 + 歌手”，可以提升命中准确率。</CardDescription>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="songs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>歌名输入</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  disabled={disabled}
                  className="min-h-44 resize-y"
                  placeholder={"晴天 周杰伦\n七里香 周杰伦\n稻香 周杰伦"}
                />
              </FormControl>
              <FormDescription>批量下载时会按列表顺序逐首处理。</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
