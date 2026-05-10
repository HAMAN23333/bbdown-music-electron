"use client";

import type { JobItem, JobView } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TaskStatusPanelProps {
  currentJobId: string | null;
  task: JobView | null;
  progress: number;
  errors: string[];
}

function statusVariant(status: JobItem["status"]) {
  switch (status) {
    case "success":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function statusText(status: JobItem["status"]) {
  const map: Record<JobItem["status"], string> = {
    pending: "等待中",
    searching: "检索中",
    downloading: "下载中",
    post_processing: "后处理",
    success: "成功",
    failed: "失败",
  };
  return map[status];
}

export function TaskStatusPanel({ currentJobId, task, progress, errors }: TaskStatusPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle>当前任务状态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {errors.length > 0 ? (
          <Alert className="border-destructive/30 bg-destructive/5">
            <AlertTitle>任务异常</AlertTitle>
            <AlertDescription>{errors[0]}</AlertDescription>
          </Alert>
        ) : null}

        {!task ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            暂无任务。填写左侧参数后点击“开始批量下载”。
          </div>
        ) : (
          <>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">任务 ID</span>
                <code className="rounded bg-muted px-2 py-0.5 text-xs">{currentJobId}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">状态：{task.status}</Badge>
                <Badge variant="outline">总数：{task.total}</Badge>
                <Badge variant="secondary">完成：{task.completed}</Badge>
                <Badge variant="secondary">成功：{task.success}</Badge>
                <Badge variant="destructive">失败：{task.failed}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                开始时间：{task.startedAt ? formatTime(task.startedAt) : "-"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">下载进度</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">歌曲处理明细</div>
              <ScrollArea className="h-[340px] rounded-md border">
                <div className="space-y-2 p-3">
                  {task.items.map((item) => (
                    <div key={item.id} className="rounded-md border bg-background p-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{item.song}</p>
                        <Badge variant={statusVariant(item.status)}>{statusText(item.status)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.message || "-"}</p>
                      {item.search ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          BVID: {item.search.bvid} | 评分: {String(item.search.score ?? "-")}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
