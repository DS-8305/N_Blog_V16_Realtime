import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import type {
  Config,
  PreparedDraft,
  Snapshot,
  EditorEvent,
  ImageReceipt,
  SaveReceipt,
  Progress,
  RunResult,
  JobState,
} from '../domain/types.js';
import { readJob, readState, writeState } from '../state/jobs.js';
import { safeFile, acquireLock, optionalJson, atomicJson, fingerprint } from '../state/files.js';
import { loadDraft } from '../editorial/bundle.js';
import { matchesSnapshot, partialDraft } from './readback.js';
import { normalizeEndpoint } from '../config.js';
export interface InputProof {
  snapshot: Snapshot;
  receipts: ImageReceipt[];
  beforeCount: number;
}
export interface EditorPort {
  targetId: string;
  verify(): Promise<void>;
  prepare(): Promise<void>;
  count(): Promise<number | null>;
  snapshot(): Promise<Snapshot>;
  apply(event: EditorEvent, draft: PreparedDraft): Promise<ImageReceipt | undefined>;
  save(): Promise<void>;
  confirm(draft: PreparedDraft, proof: InputProof): Promise<SaveReceipt | null>;
  release(): Promise<void>;
}
export interface RunOptions {
  resume?: boolean;
  open?: (config: Config, draft: PreparedDraft, targetId?: string) => Promise<EditorPort>;
}
function validReceipt(r: SaveReceipt, d: PreparedDraft, proof: InputProof): boolean {
  return (
    r.schemaVersion === 1 &&
    r.jobId === d.jobId &&
    r.fingerprint === d.fingerprint &&
    r.title === d.title &&
    Number.isFinite(Date.parse(r.confirmedAt)) &&
    Boolean(r.identity?.listText && r.identity.reopenedUrl) &&
    matchesSnapshot(d, r.snapshot, proof.receipts, proof.snapshot)
  );
}
export async function runDraft(
  job: string,
  config: Config,
  options: RunOptions = {},
): Promise<RunResult> {
  let unlock: () => Promise<void>;
  try {
    unlock = await acquireLock(await safeFile(job, 'job.lock'));
  } catch (e) {
    return { status: 'needs_user', code: (e as Error).message };
  }
  try {
    return await lockedRun(job, config, options);
  } finally {
    await unlock();
  }
}
async function lockedRun(job: string, config: Config, options: RunOptions): Promise<RunResult> {
  let state: JobState = await readState(job),
    port: EditorPort | undefined;
  let dispatched = false;
  const fail = async (status: string, code: string): Promise<RunResult> => {
    await writeState(job, { ...state, phase: status, error: code });
    return { status, code };
  };
  try {
    // These immutable paths only retrieve proof or reconcile a prior save;
    // they cannot insert text/images or click Save again. Keep currentness
    // mandatory for every path that can dispatch new work, including resume.
    const draft = await loadDraft(job, { checkFreshness: !state.receipt && !state.saveAttempt });
    if (config.blogId && config.blogId !== draft.blogId)
      return fail('needs_user', 'blog_target_changed');
    const progressPath = await safeFile(job, 'checkpoints/progress.json'),
      intentPath = await safeFile(job, 'input-intent.json'),
      proofPath = await safeFile(job, 'input-proof.json');
    let progress = await optionalJson<Progress>(progressPath),
      intent = await optionalJson<{ fingerprint: string; index: number }>(intentPath);
    if (state.receipt) {
      const proof = await optionalJson<InputProof>(proofPath),
        disk = await optionalJson<SaveReceipt>(await safeFile(job, 'receipts/draft-save.json'));
      if (
        !proof ||
        !disk ||
        fingerprint(disk) !== fingerprint(state.receipt) ||
        !validReceipt(state.receipt, draft, proof)
      )
        return fail('needs_user', 'confirmed_receipt_changed');
      return { status: 'draft_saved', receipt: state.receipt };
    }
    if (state.saveAttempt && state.saveAttempt.fingerprint !== draft.fingerprint)
      return fail('draft_unconfirmed', 'saved_fingerprint_changed');
    if ((progress || intent || state.saveAttempt) && !options.resume)
      return {
        status: state.saveAttempt ? 'draft_unconfirmed' : 'needs_user',
        code: 'resume_required',
      };
    if (
      progress &&
      (progress.fingerprint !== draft.fingerprint ||
        progress.cdpEndpoint !== normalizeEndpoint(config.cdpEndpoint) ||
        resolve(progress.profilePath) !== resolve(config.profilePath))
    )
      return fail('needs_user', 'resume_session_changed');
    if ((state.saveAttempt || intent) && !progress)
      return fail(
        state.saveAttempt ? 'draft_unconfirmed' : 'input_unconfirmed',
        'checkpoint_missing',
      );
    const open =
      options.open ??
      (async (c, d, target) => {
        const { openEditorPort } = await import('./editorPort.js');
        return openEditorPort(c, d, target);
      });
    port = await open(config, draft, progress?.targetId);
    if (progress && port.targetId !== progress.targetId)
      return fail('needs_user', 'owned_tab_changed');
    await port.verify();
    if (!state.saveAttempt) {
      if (!progress) {
        await port.prepare();
        const beforeCount = await port.count();
        if (beforeCount === null) return fail('needs_user', 'draft_list_unsupported');
        const snapshot = await port.snapshot();
        if (!matchesSnapshot(partialDraft(draft, -1), snapshot, []))
          return fail('needs_user', 'editor_not_blank');
        progress = {
          schemaVersion: 1,
          fingerprint: draft.fingerprint,
          cdpEndpoint: normalizeEndpoint(config.cdpEndpoint),
          profilePath: resolve(config.profilePath),
          targetId: port.targetId,
          index: -1,
          beforeCount,
          snapshot,
          receipts: [],
        };
        await atomicJson(progressPath, progress);
      } else {
        const current = await port.snapshot();
        if (intent) {
          if (intent.fingerprint !== draft.fingerprint)
            return fail('input_unconfirmed', 'input_intent_changed');
          if (intent.index === progress.index) {
            if (
              !matchesSnapshot(
                partialDraft(draft, progress.index),
                current,
                progress.receipts,
                progress.snapshot,
              )
            )
              return fail('input_unconfirmed', 'acknowledged_input_changed');
            await unlink(intentPath);
            intent = undefined;
          } else if (intent.index !== progress.index + 1) {
            return fail('input_unconfirmed', 'input_intent_changed');
          } else if (draft.events[intent.index]?.type === 'insertImage') {
            // A dispatched upload can remain invisible while its network request is pending.
            return fail('input_unconfirmed', 'image_dispatch_unconfirmed');
          } else if (
            matchesSnapshot(
              partialDraft(draft, progress.index),
              current,
              progress.receipts,
              progress.snapshot,
            )
          ) {
            await unlink(intentPath);
            intent = undefined;
          } else if (
            draft.events[intent.index]?.type !== 'insertImage' &&
            matchesSnapshot(
              partialDraft(draft, intent.index),
              current,
              progress.receipts,
              progress.snapshot,
            )
          ) {
            progress = { ...progress, index: intent.index, snapshot: current };
            await atomicJson(progressPath, progress);
            await unlink(intentPath);
            intent = undefined;
          } else return fail('input_unconfirmed', 'input_dispatch_unconfirmed');
        } else if (
          !matchesSnapshot(
            partialDraft(draft, progress.index),
            current,
            progress.receipts,
            progress.snapshot,
          )
        )
          return fail('needs_user', 'partial_input_changed');
      }
      state = { ...state, phase: 'inserting', error: null };
      await writeState(job, state);
      for (let index = progress.index + 1; index < draft.events.length; index++) {
        await port.verify();
        await atomicJson(intentPath, {
          schemaVersion: 1,
          fingerprint: draft.fingerprint,
          index,
          startedAt: new Date().toISOString(),
        });
        dispatched = true;
        const receipt = await port.apply(draft.events[index], draft);
        const receipts: ImageReceipt[] = receipt
          ? [...progress.receipts, receipt]
          : progress.receipts;
        const snapshot = await port.snapshot();
        if (!matchesSnapshot(partialDraft(draft, index), snapshot, receipts))
          throw Error('input_readback_mismatch');
        progress = { ...progress, index, snapshot, receipts };
        await atomicJson(progressPath, progress);
        await unlink(intentPath);
        dispatched = false;
      }
      const snapshot = await port.snapshot();
      if (!matchesSnapshot(draft, snapshot, progress.receipts, progress.snapshot))
        return fail('input_unconfirmed', 'final_input_mismatch');
      await port.verify();
      const latest = await loadDraft(job);
      if (latest.fingerprint !== draft.fingerprint)
        return fail('needs_user', 'bundle_changed_before_save');
      const proof: InputProof = {
        snapshot,
        receipts: progress.receipts,
        beforeCount: progress.beforeCount,
      };
      await atomicJson(proofPath, proof);
      state = {
        ...state,
        phase: 'save_attempted',
        error: null,
        saveAttempt: { fingerprint: draft.fingerprint, startedAt: new Date().toISOString() },
      };
      await writeState(job, state);
      try {
        await port.save();
      } catch (e) {
        return fail('draft_unconfirmed', 'save_dispatch_unconfirmed:' + (e as Error).message);
      }
    }
    const proof = await optionalJson<InputProof>(proofPath);
    if (!proof || !matchesSnapshot(draft, proof.snapshot, proof.receipts, proof.snapshot))
      return fail('draft_unconfirmed', 'input_proof_changed');
    const receipt = await port.confirm(draft, proof);
    if (!receipt || !validReceipt(receipt, draft, proof))
      return fail('draft_unconfirmed', 'saved_draft_unconfirmed');
    await atomicJson(await safeFile(job, 'receipts/draft-save.json'), receipt);
    state = { ...state, phase: 'draft_saved', error: null, receipt };
    await writeState(job, state);
    return { status: 'draft_saved', receipt };
  } catch (e) {
    const code = (e as Error).message;
    return fail(
      state.saveAttempt
        ? 'draft_unconfirmed'
        : dispatched
          ? 'input_unconfirmed'
          : /review|ENOENT|needs_user|locked|cdp|ECONNREFUSED/.test(code)
            ? 'needs_user'
            : 'failed',
      code,
    );
  } finally {
    await port?.release().catch(() => {});
  }
}
