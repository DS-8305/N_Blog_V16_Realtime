import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './args.js';
import { resolveConfig, defaults } from '../config.js';
import editorialRules from '../../config/editorial-rules.json' with { type: 'json' };
import { initJob, readJob, readState } from '../state/jobs.js';
import { readJson, optionalJson, safeFile } from '../state/files.js';
import { validateResearch } from '../domain/validation.js';
import { readContent, preparePost, recordReview, loadDraft } from '../editorial/bundle.js';
import { bodyLength, titleSimilarities, validateBodyStyleWarnings } from '../editorial/post.js';
import { collectImages, runProcess } from '../images/collect.js';
import { captureImages } from '../capture/capture.js';
import { runDraft } from '../automation/runner.js';
import {
  findChrome,
  browserAvailable,
  browserAvailableAt,
  launchChrome,
  launchGoogleChrome,
} from '../browser/launch.js';
import type { Research, AssetManifest, Post } from '../domain/types.js';
const help = `N_Blog_V16_Realtime — 네이버 실시간 이슈 임시저장 CLI

기본: 본문 ${defaults.bodyMin.toLocaleString('en-US')}~${defaults.bodyMax.toLocaleString('en-US')}자 · 소제목 ${defaults.sectionMin}~${defaults.sectionMax}개 · 이미지 ${defaults.imageMin}~${defaults.imageMax}장
제목 후보 ${editorialRules.titleCandidateCount}개 · 태그 ${editorialRules.tagCount}개 · 최신 근거 ${editorialRules.researchWindowHours}시간 이내
네이버 블로그 Chrome CDP: http://127.0.0.1:9225
구글 이미지 Chrome CDP: http://127.0.0.1:9230

node dist/cli.js <command> [options]
  doctor                 설치·Python·Chrome 연결 점검
  browser:login          포트 9225 전용 Chrome 실행 (네이버 직접 로그인)
  browser:login-google   포트 9230 구글 이미지용 Chrome 실행 (직접 로그인)
  job:init --topic 주제 --blog-id 블로그ID
  job:status --job 작업폴더
  research:check --job 작업폴더
  post:check --job 작업폴더
  image:collect --job 작업폴더 [--slot 이미지슬롯]
  capture:run --job 작업폴더 [--slot 이미지슬롯]
  post:prepare --job 작업폴더
  post:review --job 작업폴더 --fingerprint 값 --reviewer 검토자
  draft:check --job 작업폴더
  draft:run --job 작업폴더
  draft:resume --job 작업폴더

공통: --config 파일 --cdp 로컬주소 --profile 전용프로필 --google-cdp 로컬주소 --google-profile 전용프로필 --python 실행파일
초기화: --workspace 폴더 --body-min ${defaults.bodyMin} --body-max ${defaults.bodyMax} --images-per-section ${defaults.imagesPerSection}
공개 발행 명령은 없습니다. 조사·원고 작성은 Codex가 수행합니다.
`;
export async function main(argv: string[]): Promise<number> {
  try {
    const { command, options } = parseArgs(argv);
    if (command === 'help') {
      process.stdout.write(help);
      return 0;
    }
    const config = await resolveConfig(options),
      required = (name: string) => {
        if (!options[name]) throw Error('option_required:' + name);
        return options[name];
      };
    let output: unknown;
    let code = 0;
    if (command === 'job:init') {
      const jobPath = await initJob(config, required('topic'));
      output = {
        status: 'initialized',
        jobPath,
        cdpEndpoint: config.cdpEndpoint,
        bodyRange: [config.conditions.bodyMin, config.conditions.bodyMax],
        imageCount: (await readJson<Post>(await safeFile(jobPath, 'post.json'))).sections.reduce(
          (count, section) => count + section.images.length,
          0,
        ),
      };
    } else if (command === 'doctor') {
      let python = 'unavailable';
      try {
        const r = await runProcess(
          config.pythonPath,
          ['-c', "import selenium, requests, PIL, openpyxl, webdriver_manager; print('ready')"],
          config.root,
          15000,
        );
        if (r.code === 0) python = 'ready';
        else python = r.output.trim().slice(-500);
      } catch (e) {
        python = (e as Error).message;
      }
      const cdp = await browserAvailable(config),
        googleCdp = await browserAvailableAt(config.googleCdpEndpoint),
        chrome = findChrome();
      output = {
        status: python === 'ready' && chrome && cdp ? 'ready' : 'needs_user',
        node: process.version,
        python,
        pythonPath: config.pythonPath,
        chrome: chrome ?? null,
        cdpConnected: cdp,
        cdpEndpoint: config.cdpEndpoint,
        profilePath: config.profilePath,
        googleCdpConnected: googleCdp,
        googleCdpEndpoint: config.googleCdpEndpoint,
        googleProfilePath: config.googleProfilePath,
        blogId: config.blogId || null,
      };
      code = python === 'ready' && chrome && cdp ? 0 : 3;
    } else if (command === 'browser:login') output = await launchChrome(config);
    else if (command === 'browser:login-google') output = await launchGoogleChrome(config);
    else {
      const allowed = [
        'job:status',
        'research:check',
        'post:check',
        'image:collect',
        'capture:run',
        'post:prepare',
        'post:review',
        'draft:check',
        'draft:run',
        'draft:resume',
      ];
      if (!allowed.includes(command)) throw Error('unknown_command:' + command);
      const job = resolve(required('job'));
      if (command === 'job:status') {
        output = {
          jobPath: job,
          request: await readJob(job),
          state: await readState(job),
          imageCount:
            (await optionalJson<AssetManifest>(await safeFile(job, 'assets.json')))?.assets
              ?.length ?? 0,
        };
      } else if (command === 'research:check') {
        const request = await readJob(job),
          research = await readJson<Research>(await safeFile(job, 'research.json')),
          errors = validateResearch(request, research);
        if (errors.length) throw Error('validation_failed:' + errors.join(','));
        output = {
          status: 'research_valid',
          sourceCount: research.sources.length,
          factCount: research.facts.length,
        };
      } else if (command === 'post:check') {
        const content = await readContent(job);
        output = {
          status: 'post_valid',
          bodyLength: bodyLength(content.post),
          imageCount: content.post.sections.reduce((n, s) => n + s.images.length, 0),
          titleSimilarities: titleSimilarities(content.research, content.post.title),
          warnings: validateBodyStyleWarnings(content.post),
        };
      } else if (command === 'image:collect') {
        await collectImages(job, config, options.slot);
        output = { status: 'images_collected', jobPath: job };
      } else if (command === 'capture:run') {
        await captureImages(job, config, options.slot);
        output = { status: 'screens_captured', jobPath: job };
      } else if (command === 'post:prepare')
        output = { status: 'review_required', ...(await preparePost(job)) };
      else if (command === 'post:review') {
        await recordReview(job, required('fingerprint'), required('reviewer'));
        output = { status: 'reviewed' };
      } else if (command === 'draft:check') {
        const draft = await loadDraft(job);
        if (config.blogId && config.blogId !== draft.blogId)
          throw Error('needs_user:blog_target_changed');
        output = {
          status: 'draft_ready',
          title: draft.title,
          fingerprint: draft.fingerprint,
          imageCount: draft.assets.length,
          cdpEndpoint: config.cdpEndpoint,
          blogId: draft.blogId,
        };
      } else {
        const result = await runDraft(job, config, { resume: command === 'draft:resume' });
        output = result;
        code =
          result.status === 'draft_saved'
            ? 0
            : /unconfirmed/.test(result.status)
              ? 4
              : result.status === 'needs_user'
                ? 3
                : 2;
      }
    }
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return code;
  } catch (e) {
    const message = (e as Error).message;
    process.stderr.write(JSON.stringify({ status: 'error', code: message }) + '\n');
    return /needs_user|blog_id_required|review_stale|python_unavailable|ENOENT|ECONNREFUSED/.test(
      message,
    )
      ? 3
      : 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
