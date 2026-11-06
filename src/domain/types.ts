export interface Conditions {
  bodyMin: number;
  bodyMax: number;
  sectionCount: number;
  sectionMin?: number;
  sectionMax?: number;
  imagesPerSection: number;
  imageMin?: number;
  imageMax?: number;
}
export interface Config {
  root: string;
  cdpEndpoint: string;
  profilePath: string;
  googleCdpEndpoint: string;
  googleProfilePath: string;
  workspaceRoot: string;
  blogId: string;
  pythonPath: string;
  conditions: Conditions;
}
export interface JobRequest {
  schemaVersion: 1;
  jobId: string;
  topic: string;
  createdAt: string;
  timezone: 'Asia/Seoul';
  blogId: string;
  conditions: Conditions;
}
export interface Source {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  updatedAt: string | null;
  accessedAt: string;
}
export interface Fact {
  factId: string;
  text: string;
  sourceIds: string[];
  /** Older background is allowed, but cannot establish a current issue. Omitted = current. */
  temporalRole?: 'current' | 'background';
}
export interface Research {
  schemaVersion: 1;
  researchedAt: string;
  sources: Source[];
  facts: Fact[];
}
export type ImagePlan = { slotId: string; caption?: string } & (
  | { mode: 'download'; query: string; engine: 'google' | 'naver'; sourceId?: string }
  | { mode: 'download'; query: string; engine: 'direct'; sourceId: string; imageUrl: string }
  | {
      mode: 'capture';
      sourceId: string;
      url: string;
      selector: string;
      requiredLabels: string[];
      frameSelector?: string;
    }
);
export interface Section {
  sectionId: string;
  heading: string;
  paragraphs: string[];
  factIds: string[];
  images: ImagePlan[];
}
export interface Post {
  schemaVersion: 1;
  titleCandidates: string[];
  /** One distinct config/title-templates.json ID for each candidate, in the same order. */
  titleTemplateIds: number[];
  /** 본문 끝 "사진 출처 : ..." 한 줄에 넣을 실제 사진 출처(매체·공식처). 사진별 캡션은 만들지 않는다. */
  photoSources: string[];
  title: string;
  intro: string[];
  sections: Section[];
  conclusion: string[];
  tags: string[];
}
export interface Asset {
  assetId: string;
  sectionId: string;
  slotId: string;
  kind: 'download' | 'capture';
  relativePath: string;
  sha256: string;
  width: number;
  height: number;
  sourceUrl: string;
  originalUrl: string | null;
  requestedUrl?: string;
  /** Required for reuse; older unbound assets must be acquired again. */
  acquisitionFingerprint?: string;
  acquiredAt: string;
  caption: string;
  query?: string;
  engine?: string;
  selector?: string;
}
export interface AssetManifest {
  schemaVersion: 1;
  planFingerprint: string;
  assets: Asset[];
}
export type EditorEvent =
  | { type: 'setTitle' | 'typeText' | 'typeBold' | 'insertQuote'; text: string; bold?: boolean }
  | { type: 'insertImage'; assetId: string; absolutePath: string }
  | { type: 'setImageCaption'; text: string };
export interface CapturedAsset extends Asset {
  absolutePath: string;
}
export interface PreparedDraft {
  jobPath: string;
  jobId: string;
  blogId: string;
  fingerprint: string;
  title: string;
  events: EditorEvent[];
  assets: CapturedAsset[];
  expected: { bodyText: string; imageAssetIds: string[]; captions: string[]; sources: string[] };
}
export interface ImageObservation {
  key: string;
  src: string;
  loaded: boolean;
  width: number;
  height: number;
}
export type TextAlignment = 'left' | 'center' | 'right' | 'justify' | 'default';
export interface Snapshot {
  title: string;
  bodyText: string;
  images: ImageObservation[];
  layout: (
    | { kind: 'text' | 'quote'; text: string; alignment: TextAlignment }
    | { kind: 'image'; key: string; caption: string; captionAlignment: TextAlignment | null }
  )[];
}
export interface ImageReceipt {
  assetId: string;
  blockKey: string;
  index: number;
  confirmedAt: string;
}
export interface SaveReceipt {
  schemaVersion: 1;
  jobId: string;
  fingerprint: string;
  title: string;
  snapshot: Snapshot;
  confirmedAt: string;
  identity: { listText: string; reopenedUrl: string };
}
export interface Progress {
  schemaVersion: 1;
  fingerprint: string;
  cdpEndpoint: string;
  profilePath: string;
  targetId: string;
  index: number;
  beforeCount: number;
  snapshot: Snapshot;
  receipts: ImageReceipt[];
}
export interface JobState {
  schemaVersion: 1;
  phase: string;
  error: string | null;
  saveAttempt?: { fingerprint: string; startedAt: string };
  receipt?: SaveReceipt;
}
export interface RunResult {
  status: string;
  code?: string;
  receipt?: SaveReceipt;
}
