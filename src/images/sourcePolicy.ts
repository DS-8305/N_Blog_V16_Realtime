import config from '../../config/image-source-policy.json' with { type: 'json' };

export type ImageOriginKind = 'publisher' | 'official' | 'personal' | 'unknown';

export interface VerifiedOfficialImageSource {
  sourceUrl?: string;
  sourceUrlPrefix?: string;
  verifiedBy: string;
  evidenceUrl: string;
  /** Exact image URLs verified for this source; never a host-wide grant. */
  imageUrls?: readonly string[];
}

export interface ImageSourcePolicyConfig {
  blockedDomains: readonly string[];
  verifiedOfficialSources: readonly VerifiedOfficialImageSource[];
}

function httpUrl(value: unknown): URL {
  if (
    typeof value !== 'string' ||
    !/^https?:\/\//i.test(value) ||
    /[\s\x00-\x1f\x7f\\]/u.test(value) ||
    /%(?![a-f0-9]{2})/i.test(value)
  )
    throw Error('image_source_disallowed:invalid_url');
  if (/^https?:\/\/[^/?#]*@/i.test(value)) throw Error('image_source_disallowed:invalid_url');
  // Reject ambiguous dot segments before URL canonicalization or a transport can change them.
  const rawPath = value.replace(/^https?:\/\/[^/?#]+/i, '').split(/[?#]/, 1)[0];
  if (rawPath.split('/').some((part) => ['.', '..'].includes(part.replace(/%2e/gi, '.'))))
    throw Error('image_source_disallowed:invalid_url');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error('image_source_disallowed:invalid_url');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname)
    throw Error('image_source_disallowed:invalid_url');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname.startsWith('[') &&
    !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  )
    throw Error('image_source_disallowed:invalid_url');
  url.hostname = hostname;
  url.hash = '';
  return url;
}

/** Policy applies to provenance AND image bytes; a publisher page does not bless an SNS CDN. */
export function createImageSourcePolicy(policy: ImageSourcePolicyConfig) {
  const domains = [...policy.blockedDomains].map((host) => host.toLowerCase());
  if (domains.some((host) => !host || host.includes('*') || !/^[a-z0-9.-]+$/.test(host)))
    throw Error('image_policy_invalid:blocked_domain');
  const blocked = (url: URL) =>
    domains.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
  const exceptions = policy.verifiedOfficialSources.map((entry) => {
    try {
      if (
        !entry.verifiedBy?.trim() ||
        !entry.evidenceUrl ||
        !!entry.sourceUrl === !!entry.sourceUrlPrefix
      )
        throw Error('verification_required');
      httpUrl(entry.evidenceUrl);
      const address = entry.sourceUrl ?? entry.sourceUrlPrefix!;
      if (address.includes('*')) throw Error('wildcard');
      const source = httpUrl(address);
      if (source.protocol !== 'https:') throw Error('https_required');
      if (
        entry.sourceUrlPrefix &&
        (source.pathname === '/' ||
          !source.pathname.endsWith('/') ||
          source.search ||
          address.includes('#'))
      )
        throw Error('bounded_account_prefix_required');
      const images = new Set(
        (entry.imageUrls ?? []).map((address) => {
          if (address.includes('*')) throw Error('wildcard');
          return httpUrl(address).href;
        }),
      );
      return { source, prefix: !!entry.sourceUrlPrefix, images };
    } catch {
      throw Error('image_policy_invalid:official_verification');
    }
  });
  const exceptionFor = (url: URL) =>
    exceptions.find((entry) =>
      entry.prefix
        ? url.origin === entry.source.origin &&
          (url.pathname.startsWith(entry.source.pathname) ||
            url.pathname === entry.source.pathname.slice(0, -1))
        : url.href === entry.source.href,
    );

  function isDisallowedImageSource(value?: string | null): boolean {
    try {
      const url = httpUrl(value);
      return blocked(url) && !exceptionFor(url);
    } catch {
      return true;
    }
  }

  function assertAllowedImageSource(sourceUrl: string, imageUrl?: string, finalUrl?: string): void {
    const source = httpUrl(sourceUrl);
    const exception = exceptionFor(source);
    if (blocked(source) && !exception) throw Error('image_source_disallowed:source');
    for (const address of [imageUrl, finalUrl]) {
      if (address == null) continue;
      const image = httpUrl(address);
      // Only this source's exact verified image can use a normally blocked CDN.
      if ((blocked(image) || blocked(source)) && !exception?.images.has(image.href))
        throw Error('image_source_disallowed:image');
    }
  }

  function assertAllowedImageOrigin(originKind: ImageOriginKind, originUrl: string): void {
    if (originKind !== 'publisher' && originKind !== 'official')
      throw Error('image_origin_unverified:' + originKind);
    assertAllowedImageSource(originUrl);
  }

  return { isDisallowedImageSource, assertAllowedImageSource, assertAllowedImageOrigin };
}

export const disallowedImageDomains: string[] = [...config.blockedDomains];
const defaults = createImageSourcePolicy(config);
export const { isDisallowedImageSource, assertAllowedImageSource, assertAllowedImageOrigin } =
  defaults;
