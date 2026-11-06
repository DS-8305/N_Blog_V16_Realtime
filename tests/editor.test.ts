import { it, expect } from 'vitest';
import { TextWriter, type TextPort } from '../src/automation/textWriter.js';
import { matchesSnapshot } from '../src/automation/readback.js';
it('returns to the first body after the title and leaves quote formatting before three images', async () => {
  const log: string[] = [];
  const port = {
    setTitle: async (t) => {
      log.push('title:' + t);
    },
    focusBody: async (m) => {
      log.push('focus:' + m);
    },
    alignCenter: async () => {
      log.push('align:center');
    },
    type: async (t) => {
      log.push('text:' + t);
    },
    enter: async () => {
      log.push('enter');
    },
    bold: async (b) => {
      log.push('bold:' + b);
    },
    quote: async (t) => {
      log.push('quote:' + t);
    },
  } as TextPort;
  const writer = new TextWriter(port);
  await writer.apply({ type: 'setTitle', text: '제목' });
  await writer.apply({ type: 'typeText', text: '도입' });
  await writer.apply({ type: 'insertQuote', text: '첫 소제목', bold: true });
  await writer.prepareImage();
  await writer.prepareImage();
  await writer.prepareImage();
  await writer.apply({ type: 'typeText', text: '본문' });
  expect(log).toEqual([
    'title:제목',
    'focus:first',
    'align:center',
    'bold:false',
    'text:도입',
    'enter',
    'quote:첫 소제목',
    'focus:after_quote',
    'focus:last',
    'focus:last',
    'focus:last',
    'align:center',
    'bold:false',
    'text:본문',
    'enter',
  ]);
});
it('does not accept missing or reordered image resources during readback', () => {
  const draft: any = {
    title: '제목',
    events: [
      { type: 'setTitle', text: '제목' },
      { type: 'typeText', text: '본문' },
      { type: 'insertImage', assetId: 'a' },
      { type: 'setImageCaption', text: '설명1' },
      { type: 'insertImage', assetId: 'b' },
      { type: 'setImageCaption', text: '설명2' },
    ],
    assets: [
      { assetId: 'a', width: 100, height: 50 },
      { assetId: 'b', width: 100, height: 50 },
    ],
    expected: {
      bodyText: '본문\n설명1\n설명2',
      imageAssetIds: ['a', 'b'],
      captions: ['설명1', '설명2'],
      sources: [],
    },
  };
  const snap: any = {
    title: '제목',
    bodyText: '본문\n설명1\n설명2',
    layout: [
      { kind: 'text', text: '본문', alignment: 'center' },
      { kind: 'image', key: 'x', caption: '설명1', captionAlignment: 'center' },
      { kind: 'image', key: 'y', caption: '설명2', captionAlignment: 'center' },
    ],
    images: [
      {
        key: 'x',
        src: 'https://a.pstatic.net/a.png?type=w800',
        loaded: true,
        width: 100,
        height: 50,
      },
      { key: 'y', src: 'https://a.pstatic.net/b.png', loaded: true, width: 100, height: 50 },
    ],
  };
  const receipts: any = [
    { assetId: 'a', index: 0, blockKey: 'x' },
    { assetId: 'b', index: 1, blockKey: 'y' },
  ];
  expect(matchesSnapshot(draft, snap, receipts, snap)).toBe(true);
  const legacy = {
    ...snap,
    layout: snap.layout.map((block: any) => {
      const { alignment, captionAlignment, ...rest } = block;
      return rest;
    }),
  };
  expect(matchesSnapshot(draft, legacy, receipts, legacy)).toBe(true);
  expect(
    matchesSnapshot(
      draft,
      { ...snap, layout: [{ ...snap.layout[0], alignment: 'justify' }, ...snap.layout.slice(1)] } as any,
      receipts,
      snap,
    ),
  ).toBe(false);
  expect(
    matchesSnapshot(draft, { ...snap, images: [...snap.images].reverse() }, receipts, snap),
  ).toBe(false);
  expect(matchesSnapshot(draft, { ...snap, images: snap.images.slice(0, 1) }, receipts, snap)).toBe(
    false,
  );
});
it('requires native caption ownership and interleaved heading/image/body order', () => {
  const draft: any = {
    title: '제목',
    events: [
      { type: 'setTitle', text: '제목' },
      { type: 'insertQuote', text: '소제목' },
      { type: 'insertImage', assetId: 'a' },
      { type: 'setImageCaption', text: '설명' },
      { type: 'typeText', text: '본문' },
    ],
    assets: [{ assetId: 'a', width: 100, height: 50 }],
    expected: {
      bodyText: '소제목\n설명\n본문',
      imageAssetIds: ['a'],
      captions: ['설명'],
      sources: [],
    },
  };
  const image = {
    key: 'i1',
    src: 'https://blogfiles.pstatic.net/a.png',
    loaded: true,
    width: 100,
    height: 50,
  };
  const receipts: any = [{ assetId: 'a', index: 0, blockKey: 'i1' }];
  const snapshot: any = {
    title: '제목',
    bodyText: '소제목\n설명\n본문',
    images: [image],
    layout: [
      { kind: 'quote', text: '소제목', alignment: 'center' },
      { kind: 'image', key: 'i1', caption: '설명', captionAlignment: 'center' },
      { kind: 'text', text: '본문', alignment: 'center' },
    ],
  };
  expect(matchesSnapshot(draft, snapshot, receipts)).toBe(true);
  expect(
    matchesSnapshot(
      draft,
      {
        ...snapshot,
        layout: [
          { kind: 'quote', text: '소제목', alignment: 'center' },
          { kind: 'image', key: 'i1', caption: '' },
          { kind: 'text', text: '설명', alignment: 'center' },
          { kind: 'text', text: '본문', alignment: 'center' },
        ],
      },
      receipts,
    ),
  ).toBe(false);
  expect(
    matchesSnapshot(
      draft,
      { ...snapshot, layout: [snapshot.layout[0], snapshot.layout[2], snapshot.layout[1]] },
      receipts,
    ),
  ).toBe(false);
});
it('accepts a source label joined to its heading after interrupted editor input', () => {
  const source = '엠넷플러스 — 스트릿 월드 파이터 기본 정보';
  const secondSource = '와이티엔 스타 — 파이널 결과 보도';
  const draft: any = {
    title: '제목',
    events: [
      { type: 'setTitle', text: '제목' },
      { type: 'typeText', text: '자료 출처' },
      { type: 'typeText', text: source },
      { type: 'typeText', text: secondSource },
    ],
    assets: [],
    expected: {
      bodyText: `자료 출처\n${source}\n${secondSource}`,
      imageAssetIds: [],
      captions: [],
      sources: [source, secondSource],
    },
  };
  const snapshot: any = {
    title: '제목',
    bodyText: `자료 출처${source}\n${secondSource}`,
    images: [],
    layout: [
      { kind: 'text', text: `자료 출처${source}`, alignment: 'center' },
      { kind: 'text', text: secondSource, alignment: 'center' },
    ],
  };

  expect(matchesSnapshot(draft, snapshot, [])).toBe(true);
});
