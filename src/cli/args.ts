const valueNames: Record<string, string> = {
  '--topic': 'topic',
  '--job': 'job',
  '--blog-id': 'blogId',
  '--cdp': 'cdp',
  '--profile': 'profile',
  '--google-cdp': 'googleCdp',
  '--google-profile': 'googleProfile',
  '--workspace': 'workspace',
  '--python': 'python',
  '--config': 'config',
  '--fingerprint': 'fingerprint',
  '--reviewer': 'reviewer',
  '--slot': 'slot',
  '--body-min': 'bodyMin',
  '--body-max': 'bodyMax',
  '--images-per-section': 'imagesPerSection',
};
export function parseArgs(argv: string[]): { command: string; options: Record<string, string> } {
  const command = argv[0] ?? 'help',
    options: Record<string, string> = {};
  if (['--help', '-h'].includes(command)) return { command: 'help', options };
  for (let i = 1; i < argv.length; i++) {
    if (['--help', '-h'].includes(argv[i])) return { command: 'help', options: {} };
    const key = valueNames[argv[i]];
    if (!key || options[key] !== undefined) throw Error('unknown_or_duplicate_option:' + argv[i]);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error('option_value_required:' + key);
    options[key] = value;
  }
  return { command, options };
}
