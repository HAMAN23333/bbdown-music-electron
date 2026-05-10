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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SearchFilterPanelProps {
  form: UseFormReturn<DownloadFormInput, unknown, DownloadFormValues>;
  disabled?: boolean;
}

export function SearchFilterPanel({ form, disabled }: SearchFilterPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>搜索筛选</CardTitle>
        <CardDescription>按排序、时长和发布时间限制候选，减少误命中。</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="base" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="base">基础筛选</TabsTrigger>
            <TabsTrigger value="advanced">高级筛选</TabsTrigger>
          </TabsList>

          <TabsContent value="base" className="space-y-4">
            <FormField
              control={form.control}
              name="orderType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>搜索排序</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="totalrank">综合排序（totalrank）</SelectItem>
                      <SelectItem value="pubdate">最新发布（pubdate）</SelectItem>
                      <SelectItem value="click">最多点击（click）</SelectItem>
                      <SelectItem value="stow">最多收藏（stow）</SelectItem>
                      <SelectItem value="dm">最多弹幕（dm）</SelectItem>
                      <SelectItem value="scores">最多评论（scores）</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="timeRange"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>时长筛选（分钟）</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={-1}
                        max={720}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                        disabled={disabled}
                      />
                    </FormControl>
                    <FormDescription>-1 表示不限。</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pageSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>每页候选数量</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={42}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                        disabled={disabled}
                      />
                    </FormControl>
                    <FormDescription>范围 1-42。</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="maxCandidates"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>评分候选上限</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                      disabled={disabled}
                    />
                  </FormControl>
                  <FormDescription>范围 1-20，默认 8。</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
            <FormField
              control={form.control}
              name="videoZoneType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>视频分区 tid（可选）</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="如 3 表示音乐分区" disabled={disabled} />
                  </FormControl>
                  <FormDescription>留空则不按分区筛选。</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="timeStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>发布时间开始</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" disabled={disabled} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>发布时间结束</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" disabled={disabled} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
