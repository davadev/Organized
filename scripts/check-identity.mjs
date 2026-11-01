import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (manifest.author !== 'davadev') throw Error('Project attribution must be davadev only.');
if (!readFileSync('LICENSE', 'utf8').includes('Copyright (c) 2026 davadev')) throw Error('Project license attribution must be davadev.');
const identities = execFileSync('git', ['log', '--format=%an%n%cn'], { encoding: 'utf8' }).trim().split('\n');
const commits = execFileSync('git', ['log', '--format=%an%x09%ae%x09%cn%x09%ce'], { encoding: 'utf8' }).trim().split('\n');
if (commits.some(line => {
  const [author, authorEmail, committer, committerEmail] = line.split('\t');
  return !['davadev', 'Dany'].includes(author) || authorEmail !== '67618972+davadev@users.noreply.github.com'
    || !(['davadev', 'Dany'].includes(committer) && committerEmail === '67618972+davadev@users.noreply.github.com')
      && !(committer === 'GitHub' && committerEmail === 'noreply@github.com');
})) throw Error('Commit authors must be davadev or Dany; committers must match or be GitHub <noreply@github.com>.');
const emails = execFileSync('git', ['log', '--format=%ae%n%ce'], { encoding: 'utf8' }).trim().split('\n');
if (emails.some(email => email !== '67618972+davadev@users.noreply.github.com' && email !== 'noreply@github.com')) throw Error('Project commits must use the davadev or GitHub no-reply address.');
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const path of paths) {
  if (path.endsWith('.png')) continue;
  const text = readFileSync(path, 'utf8');
  if (/\/(?:Users|home)\/[^/\s]+\//.test(text)) throw Error(`Private local path in ${path}`);
}
console.log('Project attribution, commit identities and local-path privacy verified.');
