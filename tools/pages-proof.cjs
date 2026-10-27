// Compare actual first-party browser responses with the deployed Git commit.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
exports.createPagesProof=(page,{base,release})=>{
 assert.match(release||'',/^[a-f0-9]{40}$/,'RELEASE_SHA is required for public verification');
 const origin=new URL(base),seen=new Set(),pending=[],files=[];
 page.on('response',response=>{
  const u=new URL(response.url());if(u.origin!==origin.origin||!u.pathname.startsWith(origin.pathname))return;
  const relative=decodeURIComponent(u.pathname.slice(origin.pathname.length));
  if(!relative||relative.split('/').some(p=>p==='..')||seen.has(relative))return;seen.add(relative);
  if(!fs.existsSync(path.join(root,relative)))return;
  pending.push((async()=>{
   const expected=cp.execFileSync('/usr/bin/git',['show',`${release}:${relative}`],{cwd:root,maxBuffer:32*1024*1024});
   let data=await response.buffer(),status=response.status(),method='browser-response';
   if(!data.length&&expected.length){const r=await fetch(u,{headers:{'Cache-Control':'no-cache'}});status=r.status;data=Buffer.from(await r.arrayBuffer());method='independent-http';}
   files.push({path:relative,status,method,bytes:data.length,sha256:hash(data),matchesCommit:hash(data)===hash(expected)});
  })());
 });
 return async output=>{
  await Promise.all(pending);files.sort((a,b)=>a.path.localeCompare(b.path));
  fs.writeFileSync(output,JSON.stringify({base,release,date:new Date().toISOString(),files},null,2)+'\n');
  assert.ok(files.length>=15,'runtime files must be observed');assert.ok(files.every(f=>f.status===200&&f.matchesCommit),'published files differ from release commit');return files.length;
 };
};
