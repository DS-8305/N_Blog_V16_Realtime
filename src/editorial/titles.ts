import type { Post } from '../domain/types.js';
import templates from '../../config/title-templates.json' with { type: 'json' };
import policy from '../../config/editorial-rules.json' with { type: 'json' };

const knownTemplates = new Set(templates.templates.map((template) => template.id));
export function validateTitles(post: Post): string[] {
  const errors: string[] = [];
  if (
    !Array.isArray(post.titleTemplateIds) ||
    post.titleTemplateIds.length !== policy.titleCandidateCount ||
    new Set(post.titleTemplateIds).size !== policy.titleCandidateCount ||
    post.titleTemplateIds.some((id) => !Number.isInteger(id) || !knownTemplates.has(id))
  )
    errors.push('title_templates');
  if (!Array.isArray(post.titleCandidates)) return errors;
  post.titleCandidates.forEach((title, index) => {
    if (typeof title !== 'string') return;
    const length = Array.from(title.normalize('NFC').trim()).length;
    if (length < templates.rules.lengthMin || length > templates.rules.lengthLimit)
      errors.push('title_length:' + index);
    if (templates.rules.requireNumber && !/\d/u.test(title))
      errors.push('title_number_required:' + index);
    if (templates.rules.bannedSymbols.some((symbol) => title.includes(symbol)))
      errors.push('title_symbol_forbidden:' + index);
  });
  return errors;
}
export function titleWarnings(post: Post): string[] {
  return (Array.isArray(post.titleCandidates) ? post.titleCandidates : []).flatMap(
    (title, index) => {
      if (typeof title !== 'string') return [];
      const length = Array.from(title.normalize('NFC').trim()).length;
      return length > templates.rules.lengthMax && length <= templates.rules.lengthLimit
        ? [`title_length_recommended:${index}:chars=${length}>${templates.rules.lengthMax}`]
        : [];
    },
  );
}
