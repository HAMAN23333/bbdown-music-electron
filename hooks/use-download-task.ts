"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { DownloadFormValues } from "@/lib/schema";
import type { JobView } from "@/lib/types";
import { createJob, getHealth, getJob } from "@/services/download-service";

export function useDownloadTask() {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
  });

  const createJobMutation = useMutation({
    mutationFn: (values: DownloadFormValues) => createJob(values),
    onSuccess: (data) => {
      setCurrentJobId(data.jobId);
    },
  });

  const jobQuery = useQuery({
    queryKey: ["job", currentJobId],
    queryFn: () => getJob(currentJobId as string),
    enabled: Boolean(currentJobId),
    refetchInterval: (query) => {
      const data = query.state.data as JobView | undefined;
      if (!data) return 1_500;
      return data.status === "running" ? 1_500 : false;
    },
    refetchIntervalInBackground: true,
    networkMode: "always",
  });

  const startTask = async (values: DownloadFormValues) => {
    await createJobMutation.mutateAsync(values);
  };

  const task = jobQuery.data ?? null;
  const isSubmitting = createJobMutation.isPending;
  const isRunning = task?.status === "running";
  const isBusy = isSubmitting || isRunning;

  const progress = useMemo(() => {
    if (!task || task.total <= 0) return 0;
    return Math.min(100, Math.round((task.completed / task.total) * 100));
  }, [task]);

  return {
    currentJobId,
    healthQuery,
    taskQuery: jobQuery,
    task,
    startTask,
    progress,
    isRunning,
    isSubmitting,
    isBusy,
    createError: createJobMutation.error,
    taskError: jobQuery.error,
  };
}
