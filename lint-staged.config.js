// Lint and format only what's staged. Large changesets (e.g. an initial commit) switch to whole-project
// commands, which is faster and avoids the Windows command-line length limit.
const MANY = 40;
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

const config = {
  '*.{ts,tsx}': (files) =>
    files.length > MANY
      ? ['eslint --fix --max-warnings=0 .', 'prettier --write "**/*.{ts,tsx}"']
      : [`eslint --fix --max-warnings=0 ${quote(files)}`, `prettier --write ${quote(files)}`],
  '*.{css,json,md,html,yml,yaml}': (files) =>
    files.length > MANY ? ['prettier --write "**/*.{css,json,md,html,yml,yaml}"'] : [`prettier --write ${quote(files)}`],
};

export default config;
