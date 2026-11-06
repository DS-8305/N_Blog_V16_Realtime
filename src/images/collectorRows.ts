export interface CollectorRow {
  status: string;
  file_name: string;
  saved_path: string;
  source_url?: string;
  original_url?: string;
  downloaded_url?: string;
  download_kind?: string;
  [key: string]: unknown;
}

export function savedImages(run: unknown): CollectorRow[] {
  const data = run as { jobs?: Record<string, { folder?: string; records?: any[] }> };
  return Object.values(data.jobs ?? {}).flatMap((job) =>
    (job.records ?? [])
      .filter((r) => r.status === 'saved' && typeof r.file_name === 'string' && r.file_name)
      .map((r) => ({
        ...r,
        saved_path: [job.folder ?? '', r.file_name].filter(Boolean).join('/'),
      })),
  );
}
