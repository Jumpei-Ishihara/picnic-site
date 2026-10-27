const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'..',process.env.PONY_OUT||'docs/pony-validation'),results=[];
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];
for(const seconds of [6,12]){
 const file=path.join(out,`pony-${seconds}s.mp4`);
 const meta=JSON.parse(cp.execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',file],{encoding:'utf8'}));
 const times=meta.frames.map(f=>+f.best_effort_timestamp_time);
 const raw=cp.execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',file,'-vf','scale=320:180:flags=neighbor','-f','rawvideo','-pix_fmt','rgb24','-enc_time_base','1:60000','-vsync','0','-'],{maxBuffer:256*1024*1024});
 const stride=320*180*3,n=raw.length/stride;assert.equal(n,times.length);
 const diff=(a,b)=>{let sum=0,roi=0;for(let y=0;y<180;y++)for(let x=0;x<320;x++)for(let c=0;c<3;c++){const i=(y*320+x)*3+c,d=Math.abs(raw[a*stride+i]-raw[b*stride+i]);sum+=d;if(y>=62&&y<112&&x>=125&&x<230)roi+=d;}return {full:sum/stride,roi:roi/(50*105*3)};};
 const steps=[];for(let i=1;i<n;i++)steps.push(diff(i-1,i));const wrap=diff(n-1,0);
 const result={file:path.basename(file),frames:n,firstPTS:times[0],lastPTS:times.at(-1),wrapMeanAbsRGB:wrap.full,adjacentMeanAbsRGBP95:percentile(steps.map(x=>x.full),.95),ponyROIWrap:wrap.roi,ponyROIAdjacentP95:percentile(steps.map(x=>x.roi),.95),maxFrameIntervalSeconds:Math.max(...times.slice(1).map((t,i)=>t-times[i]))};
 for(const [label,index] of [['first',0],['last',n-1]])cp.execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-y','-i',file,'-vf',`select=eq(n\\,${index})`,'-frames:v','1',path.join(out,`${seconds}s-${label}.png`)]);
 results.push(result);
}
fs.writeFileSync(path.join(out,'video-seams.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
