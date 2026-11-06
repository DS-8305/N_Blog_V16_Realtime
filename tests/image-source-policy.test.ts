import { describe, expect, it } from 'vitest';
import {
  assertAllowedImageOrigin,
  assertAllowedImageSource,
  createImageSourcePolicy,
  isDisallowedImageSource,
} from '../src/images/sourcePolicy.js';

it('blocks ordinary Instagram image sources', () => {
  expect(isDisallowedImageSource('https://www.instagram.com/private_account/p/123/')).toBe(true);
});

it.each([
  'https://INSTAGRAM.COM./ordinary/p/1/',
  'https://instagr.am/p/1/',
  'https://scontent.cdninstagram.com/photo.jpg',
  'https://private.blog.naver.com/post/1',
  'https://postfiles.pstatic.net/Mj/photo.png',
  'https://blogfiles.naver.net/photo.jpg',
  'https://private.tistory.com/1',
  'https://blog.kakaocdn.net/image.png',
  'https://person.blogspot.com/1',
  'https://blogger.googleusercontent.com/img/a/photo.png',
  'https://lh3.googleusercontent.com/private-blog/photo.png',
  'https://person.wordpress.com/1',
  'https://www.reddit.com/r/pics/1',
  'https://i.redd.it/photo.jpg',
  'https://scontent.fbcdn.net/photo.jpg',
  'https://namu.wiki/w/example',
])('blocks known personal/community/wiki sources and their CDN: %s', (url) => {
  expect(isDisallowedImageSource(url)).toBe(true);
  expect(() => assertAllowedImageSource('https://news.example/article', url)).toThrow(
    'image_source_disallowed',
  );
});

it.each([
  undefined,
  null,
  '',
  'not a URL',
  'https:news.example/photo',
  'file:///photo.png',
  'data:image/png;base64,abc',
  'https://instagram.com@news.example/photo',
  'https://@news.example/photo',
  'https://news.example@instagram.com/photo',
  'https://news.example:99999/photo',
  'https://news.example/white space',
  'https://news.example/%ZZ',
  'https://news.example\\@elsewhere.example/photo',
])('rejects missing, malformed and misleading addresses: %s', (url) => {
  expect(isDisallowedImageSource(url)).toBe(true);
});

it('allows publisher images while checking source, requested image and final destination separately', () => {
  expect(isDisallowedImageSource('https://www.yna.co.kr/view/article')).toBe(false);
  expect(isDisallowedImageSource('https://imgnews.pstatic.net/image/001/photo.jpg')).toBe(false);
  expect(isDisallowedImageSource('https://notinstagram.com/photo.jpg')).toBe(false);
  expect(isDisallowedImageSource('https://news.example?next=/../archive')).toBe(false);
  expect(() =>
    assertAllowedImageSource(
      'https://www.yna.co.kr/view/article',
      'https://imgnews.pstatic.net/image/001/photo.jpg',
      'https://cdn.publisher.example/photo.jpg',
    ),
  ).not.toThrow();
  expect(() =>
    assertAllowedImageSource(
      'https://news.example/article',
      'https://cdn.publisher.example/photo.jpg',
      'https://blogfiles.pstatic.net/personal.jpg',
    ),
  ).toThrow('image_source_disallowed');
});

it('requires origin review even for a publisher reprinting a personal image', () => {
  expect(() => assertAllowedImageOrigin('publisher', 'https://news.example/article')).not.toThrow();
  expect(() => assertAllowedImageOrigin('official', 'https://agency.example/photos')).not.toThrow();
  expect(() =>
    assertAllowedImageOrigin('personal', 'https://ordinary-person.example/post'),
  ).toThrow('image_origin_unverified');
  expect(() => assertAllowedImageOrigin('unknown', 'https://news.example/article')).toThrow(
    'image_origin_unverified',
  );
  expect(() =>
    assertAllowedImageOrigin('official', 'https://instagram.com/verified_badge/'),
  ).toThrow('image_source_disallowed');
});

describe('configured verification', () => {
  const config = {
    blockedDomains: [
      'instagram.com',
      'cdninstagram.com',
      'blog.naver.com',
      'postfiles.pstatic.net',
    ],
    verifiedOfficialSources: [
      {
        sourceUrlPrefix: 'https://www.instagram.com/agency/',
        verifiedBy: 'Editor',
        evidenceUrl: 'https://agency.example/official-accounts',
        imageUrls: ['https://scontent.cdninstagram.com/agency-photo.jpg'],
      },
      {
        sourceUrl: 'https://blog.naver.com/agency/123',
        verifiedBy: 'Editor',
        evidenceUrl: 'https://agency.example/blog',
        imageUrls: ['https://postfiles.pstatic.net/agency-photo.jpg'],
      },
    ],
  };

  it('allows only the verified account or exact page with its recorded image', () => {
    const policy = createImageSourcePolicy(config);
    expect(() =>
      policy.assertAllowedImageSource(
        'https://www.instagram.com/agency/p/123/',
        'https://scontent.cdninstagram.com/agency-photo.jpg',
      ),
    ).not.toThrow();
    expect(() =>
      policy.assertAllowedImageOrigin('official', 'https://www.instagram.com/agency/'),
    ).not.toThrow();
    expect(() =>
      policy.assertAllowedImageSource(
        'https://blog.naver.com/agency/123',
        'https://postfiles.pstatic.net/agency-photo.jpg',
      ),
    ).not.toThrow();
    expect(policy.isDisallowedImageSource('https://blog.naver.com/agency/124')).toBe(true);
    expect(policy.isDisallowedImageSource('https://www.instagram.com/agency_imposter/p/123/')).toBe(
      true,
    );
    expect(policy.isDisallowedImageSource('https://www.instagram.com/elsewhere/')).toBe(true);
  });

  it('does not let a publisher or another approved source borrow a verified CDN image', () => {
    const policy = createImageSourcePolicy(config);
    for (const source of ['https://news.example/article', 'https://blog.naver.com/agency/123']) {
      expect(() =>
        policy.assertAllowedImageSource(
          source,
          'https://scontent.cdninstagram.com/agency-photo.jpg',
        ),
      ).toThrow('image_source_disallowed');
    }
    expect(() =>
      policy.assertAllowedImageSource(
        'https://www.instagram.com/agency/p/123/',
        'https://scontent.cdninstagram.com/personal-photo.jpg',
      ),
    ).toThrow('image_source_disallowed');
    expect(() =>
      policy.assertAllowedImageSource(
        'https://www.instagram.com/agency/p/123/',
        'https://images.publisher.example/unverified-photo.jpg',
      ),
    ).toThrow('image_source_disallowed');
    expect(() =>
      policy.assertAllowedImageSource(
        'https://www.instagram.com/agency/p/123/',
        'https://scontent.cdninstagram.com/agency-photo.jpg',
        'https://postfiles.pstatic.net/agency-photo.jpg',
      ),
    ).toThrow('image_source_disallowed');
  });

  it.each([
    { ...config.verifiedOfficialSources[0], verifiedBy: '' },
    { ...config.verifiedOfficialSources[0], evidenceUrl: '' },
    { ...config.verifiedOfficialSources[0], sourceUrlPrefix: 'https://www.instagram.com/' },
    { ...config.verifiedOfficialSources[0], sourceUrlPrefix: 'https://www.instagram.com/agency*' },
    { ...config.verifiedOfficialSources[0], sourceUrlPrefix: 'https://www.instagram.com/agency' },
    {
      ...config.verifiedOfficialSources[0],
      sourceUrlPrefix: 'https://www.instagram.com/agency/#elsewhere',
    },
  ])('rejects incomplete or broad exception configuration', (entry) => {
    expect(() => createImageSourcePolicy({ ...config, verifiedOfficialSources: [entry] })).toThrow(
      'image_policy_invalid',
    );
  });
});
