import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (manifest.author !== 'davadev') throw Error('Project attribution must be davadev only.');
if (!readFileSync('LICENSE', 'utf8').includes('Copyright (c) 2026 davadev')) throw Error('Project license attribution must be davadev.');
const OWNER = '67618972+davadev@users.noreply.github.com';
// Dependabot's commits name a public bot, no person. Without this its pull requests could never pass, and every update had to be re-applied by hand.
const BOT = { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' };
const commits = execFileSync('git', ['log', '--format=%an%x09%ae%x09%cn%x09%ce'], { encoding: 'utf8' }).trim().split('\n');
if (commits.some(line => {
  const [author, authorEmail, committer, committerEmail] = line.split('\t');
  return !(['davadev', 'Dany'].includes(author) && authorEmail === OWNER) && !(author === BOT.name && authorEmail === BOT.email)
    || !(['davadev', 'Dany'].includes(committer) && committerEmail === OWNER)
      && !(committer === 'GitHub' && committerEmail === 'noreply@github.com');
})) throw Error('Commit authors must be davadev, Dany or dependabot[bot]; committers must be davadev, Dany or GitHub <noreply@github.com>.');
const emails = execFileSync('git', ['log', '--format=%ae%n%ce'], { encoding: 'utf8' }).trim().split('\n');
if (emails.some(email => email !== OWNER && email !== BOT.email && email !== 'noreply@github.com')) throw Error('Project commits must use the davadev, Dependabot or GitHub no-reply address.');
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const path of paths) {
  if (path.endsWith('.png')) continue;
  const text = readFileSync(path, 'utf8');
  if (/\/(?:Users|home)\/[^/\s]+\//.test(text)) throw Error(`Private local path in ${path}`);
}
console.log('Project attribution, commit identities and local-path privacy verified.');
