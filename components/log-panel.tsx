"use client";

import type { JobLog } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface LogPanelProps {
  logs: JobLog[];
  onClear: () => void;
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>运行日志</CardTitle>
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            清空日志显示
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[260px] rounded-md border bg-slate-950">
          {logs.length === 0 ? (
            <div className="flex h-full min-h-[240px] items-center justify-center px-4 text-center text-xs text-slate-400">
              暂无日志输出。
            </div>
          ) : (
            <div className="console-text p-3 text-xs text-slate-100">
              {logs.map((line, index) => (
                <div key={`${line.time}-${index}`}>
                  <span className="text-slate-400">[{line.time}]</span> {line.message}
                  {index < logs.length - 1 ? <Separator className="my-1 bg-slate-800" /> : null}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
