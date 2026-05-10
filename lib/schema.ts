import { z } from "zod";

const audioFormatSchema = z.enum(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "original"]);
const orderTypeSchema = z.enum(["totalrank", "pubdate", "click", "stow", "dm", "scores"]);

export const downloadFormSchema = z
  .object({
    songs: z.string().min(1, "请至少输入一首歌曲（每行一首）"),
    outputDir: z.string().trim().default(""),
    maxConcurrent: z.coerce.number<number | string>().int().min(1).max(8),
    cookie: z.string().default(""),
    audioFormat: audioFormatSchema.default("mp3"),
    audioBitrateKbps: z.coerce.number<number | string>().int().min(64).max(320),
    orderType: orderTypeSchema.default("totalrank"),
    timeRange: z.coerce.number<number | string>().int().min(-1).max(720),
    videoZoneType: z.string().default(""),
    timeStart: z.string().default(""),
    timeEnd: z.string().default(""),
    pageSize: z.coerce.number<number | string>().int().min(1).max(42),
    maxCandidates: z.coerce.number<number | string>().int().min(1).max(20),
  })
  .refine(
    (value) =>
      (value.timeStart.length === 0 && value.timeEnd.length === 0) ||
      (value.timeStart.length > 0 && value.timeEnd.length > 0),
    {
      message: "发布时间开始与结束需要同时设置",
      path: ["timeEnd"],
    }
  );

export type DownloadFormInput = z.input<typeof downloadFormSchema>;
export type DownloadFormValues = z.output<typeof downloadFormSchema>;

export const downloadFormDefaults: DownloadFormInput = {
  songs: "",
  outputDir: "",
  maxConcurrent: 2,
  cookie: "",
  audioFormat: "mp3",
  audioBitrateKbps: 192,
  orderType: "totalrank",
  timeRange: -1,
  videoZoneType: "",
  timeStart: "",
  timeEnd: "",
  pageSize: 20,
  maxCandidates: 8,
};

export const BITRATE_DISABLED_FORMATS = new Set(["original", "flac", "wav"]);
