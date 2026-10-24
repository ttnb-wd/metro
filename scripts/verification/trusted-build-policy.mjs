import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
// This is a trusted-source release gate, not a patch or acceptance of GHSA-vfj7-8cjw-p6xm.
// Config changes require renewed review; untrusted pull requests must not run
// project-supplied config/scripts with secrets or a privileged workspace.
const policy=JSON.parse(readFileSync(new URL('./trusted-build-policy.json',import.meta.url),'utf8'));
if(Date.now()>=Date.parse(policy.reviewBy))throw Error('Development advisory review expired. Recheck upstream and review trusted-build policy.');
for(const [file,expected]of Object.entries(policy.reviewedFiles)){
 if(createHash('sha256').update(readFileSync(file)).digest('hex')!==expected)throw Error('Build configuration changed; trusted-source review required.');
}
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
for(const [file,p]of Object.entries(lock.packages)){
 if(/(?:^|\/)node_modules\/braces$/.test(file)&&(!p.dev||p.version!=='3.0.3'))throw Error('braces dependency exposure changed; review advisory and runtime boundary.');
}
if(/rootDir\s*:/.test(readFileSync('eslint.config.mjs','utf8')))throw Error('Dynamic Next.js root-directory globs require separate security review.');
const manifest=JSON.parse(readFileSync('package.json','utf8'));
if(!isDeepStrictEqual(manifest.overrides??{},policy.reviewedOverrides??{}))throw Error('Dependency overrides differ from the exact reviewed compatibility policy.');
for(const [file,p]of Object.entries(lock.packages)){
 const [major,minor,patch]=(p.version??'0.0.0').split('.').map(Number);
 if(/(?:^|\/)node_modules\/zod$/.test(file)&&(major<4||major===4&&(minor<6||minor===6&&patch<6)))throw Error('Unpatched transitive Zod requires review.');
}
console.log('Trusted-build restrictions active; upstream advisory withdrawn, review deadline retained at '+policy.reviewBy+'. No risk acceptance recorded.');
