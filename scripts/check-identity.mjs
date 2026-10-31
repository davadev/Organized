import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (manifest.author !== 'davadev') throw Error('Project attribution must be davadev only.');
if (!readFileSync('LICENSE', 'utf8').includes('Copyright (c) 2026 davadev')) throw Error('Project license attribution must be davadev.');
const identities = execFileSync('git', ['log', '--all', '--format=%an%n%cn'], { encoding: 'utf8' }).trim().split('\n');
if (identities.some(name => name !== 'davadev')) throw Error('Every project commit author and committer must be davadev.');
const emails = execFileSync('git', ['log', '--all', '--format=%ae%n%ce'], { encoding: 'utf8' }).trim().split('\n');
if (emails.some(email => email !== '67618972+davadev@users.noreply.github.com')) throw Error('Every project commit must use the davadev GitHub no-reply address.');
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const path of paths) {
  if (path.endsWith('.png')) continue;
  const text = readFileSync(path, 'utf8');
  if (/\/(?:Users|home)\/[^/\s]+\//.test(text)) throw Error(`Private local path in ${path}`);
}
console.log('Project attribution, commit identities and local-path privacy verified.');
