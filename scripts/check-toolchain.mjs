import { execFileSync } from 'node:child_process';
if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Use Node 24 for reproducible builds.');
const npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const [major, minor] = npm.split('.').map(Number);
if (!(major > 11 || (major === 11 && minor >= 10))) throw Error('npm >=11.10 is required to enforce dependency age and install-script denial.');
console.log(`Toolchain verified: Node ${process.versions.node}, npm ${npm}.`);
