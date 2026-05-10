"use client";

import type { HealthResponse } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ActionBarProps {
  health?: HealthResponse;
  isBusy: boolean;
  isRunning: boolean;
}

export function ActionBar({ health, isBusy, isRunning }: ActionBarProps) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-wrap gap-2">
        <Badge variant={health?.bundledBbdownReady ? "secondary" : "destructive"}>
          {health?.bundledBbdownReady ? "BBDown 已就绪" : "BBDown 未就绪"}
        </Badge>
        <Badge variant={health?.bundledFfmpegReady ? "secondary" : "destructive"}>
          {health?.bundledFfmpegReady ? "FFmpeg 已就绪" : "FFmpeg 未就绪"}
        </Badge>
      </div>

      <Button type="submit" disabled={isBusy} className="h-11 text-base">
        {isBusy ? (isRunning ? "下载任务运行中..." : "提交任务中...") : "开始批量下载"}
      </Button>
    </div>
  );
}
