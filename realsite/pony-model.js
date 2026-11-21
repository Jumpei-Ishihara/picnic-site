// Shared modelling source for the site and tools/build-pony-spline.mjs.
// Metres, Y up, forward -Z. Neck/head coordinates are relative to the neck pivot.
export const PONY_PALETTE = { hoof: '#443b36', tack: '#654636', saddle: '#b8463f' };
export const PONY_RIG = {
  neck: [0, .95, -.43], neckAngle: -.30, poll: [0, .44, -.10], tail: [0, .94, .61],
  lead: [-.14, .335, -.575], saddleY: 1.10,
  hips: [[-.18,.80,-.45],[.18,.80,-.45],[-.18,.83,.45],[.18,.83,.45]],
  // Proximal muscle is mostly inside the body; exposed distal joints differ.
  fore: {proximal:.25, upper:.30, lower:.25, reach:.548, widths:[.14,.11,.09,.08]},
  hind: {proximal:.27, upper:.295, lower:.275, reach:.538, widths:[.14,.12,.095,.08]},
  stridesPerLoop:10,
  hoof: [.12,.07,.16]
};

// Block proportions, metres. Flat faces are split for hard normals in GLB too.
const box=(name,p,s)=>({name,shape:'box',p,s});
export const PONY_MODEL={
  body:[box('Barrel',[0,.80,.02],[.50,.50,1.14])],
  neck:[box('Neck',[0,.15,-.045],[.28,.58,.30])],
  head:[box('Face',[0,.43,-.185],[.29,.34,.42]),
    box('Muzzle',[0,.335,-.43],[.25,.18,.24]),
    ...[-1,1].map(s=>box('Ear '+s,[s*.095,.665,-.10],[.065,.16,.06]))],
  eyes:[...[-1,1].map(s=>box('Eye '+s,[s*.149,.47,-.35],[.018,.037,.043])),
    ...[-1,1].map(s=>box('Nostril '+s,[s*.09,.385,-.554],[.025,.022,.01]))],
  mane:[box('Mane strip',[0,.24,.12],[.13,.52,.12]),
    box('Forelock',[0,.565,-.25],[.24,.10,.13])],
  tail:[box('Tail upper',[0,-.125,.03],[.11,.25,.11]),
    box('Tail lower',[0,-.33,.055],[.13,.20,.13])],
  halter:[box('Noseband',[0,.335,-.563],[.27,.035,.024]),
    box('Poll strap',[0,.565,-.16],[.32,.032,.035]),
    ...[-1,1].flatMap(s=>[
      box('Cheek strap '+s,[s*.152,.345,-.42],[.022,.032,.27]),
      box('Upright strap '+s,[s*.153,.46,-.285],[.022,.23,.026]),
      box('Upper cheek strap '+s,[s*.153,.565,-.225],[.022,.032,.16])])],
  saddle:[box('Saddle blanket',[0,1.045,0],[.512,.06,.42])],
  seat:[box('Saddle seat',[0,1.09,0],[.34,.045,.30]),
    ...[-1,1].map(s=>box('Girth '+s,[s*.257,.88,0],[.022,.30,.075]))],
  patch:[...[-1,1].flatMap(s=>[
    box('Pinto front '+s,[s*.253,.83,-.20],[.014,.20,.23]),
    box('Pinto rear '+s,[s*.253,.84,.24],[.014,.18,.18]),
    box('Pinto lower '+s,[s*.253,.68,-.12],[.014,.12,.13])])],
  limb:box('Square hoof',[0,0,0],[1,1,1])
};

// Four-sided ring loft. Neighbouring sections use identical joint positions;
// faces duplicate vertices for hard normals, but share the same boundary points.
// Kept self-contained so tools/build-pony-spline.mjs can embed ponyPartMesh.toString().
export function ponyPartMesh(part){
  const vertices=[],indices=[],ring=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  const rings=[];
  if(part.shape==='chain'){
    const points=part.points.slice().reverse(),widths=part.widths.slice().reverse();
    const segs=[];
    for(let j=0;j<points.length-1;j++){
      const dx=points[j+1][0]-points[j][0],dy=points[j+1][1]-points[j][1],dz=points[j+1][2]-points[j][2];
      const len=Math.hypot(dx,dy,dz);
      segs.push(len>1e-8?[dx/len,dy/len,dz/len]:[0,1,0]);
    }
    for(let j=0;j<points.length;j++){
      let dx,dy,dz;
      if(j===0){
        const s=segs[0]||[0,1,0];
        if(part.footUp){
          dx=s[0]+part.footUp[0];dy=s[1]+part.footUp[1];dz=s[2]+part.footUp[2];
          const l=Math.hypot(dx,dy,dz);
          if(l>1e-8){dx/=l;dy/=l;dz/=l;}else{dx=s[0];dy=s[1];dz=s[2];}
        }else{dx=s[0];dy=s[1];dz=s[2];}
      }else if(j===points.length-1){
        const s=segs[j-1]||[0,1,0];dx=s[0];dy=s[1];dz=s[2];
      }else{
        const s0=segs[j-1],s1=segs[j];
        dx=s0[0]+s1[0];dy=s0[1]+s1[1];dz=s0[2]+s1[2];
        const l=Math.hypot(dx,dy,dz);
        if(l>1e-8){dx/=l;dy/=l;dz/=l;}else{dx=s1[0];dy=s1[1];dz=s1[2];}
      }
      let xx=1-dx*dx,xy=-dx*dy,xz=-dx*dz,xl=Math.hypot(xx,xy,xz);
      if(xl>1e-8){xx/=xl;xy/=xl;xz/=xl;}else{xx=0;xy=0;xz=1;}
      const zx=xy*dz-xz*dy,zy=xz*dx-xx*dz,zz=xx*dy-xy*dx;
      const p=points[j],w=widths[j];
      rings.push(ring.map(([u,v])=>[p[0]+w*(u*xx+v*zx),p[1]+w*(u*xy+v*zy),p[2]+w*(u*xz+v*zz)]));
    }
  }else{
    for(const y of [-.5,.5])rings.push(ring.map(([x,z])=>[x,y,z]));
  }
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<4;i++){
    const next=(i+1)%4,offset=vertices.length/3;
    vertices.push(...rings[j][i],...rings[j+1][i],...rings[j][next],...rings[j+1][next]);
    indices.push(offset,offset+1,offset+2,offset+2,offset+1,offset+3);
  }
  for(const end of [0,rings.length-1]){
    const k=vertices.length/3;for(const p of rings[end])vertices.push(...p);
    if(end===0)indices.push(k,k+1,k+2,k,k+2,k+3);else indices.push(k,k+2,k+1,k,k+3,k+2);
  }
  for(let i=0;i<vertices.length;i++)vertices[i]=vertices[i]*part.s[i%3]+part.p[i%3];
  return {vertices,indices};
}
export const ponyLegPart=(points,leg,footUp=null)=>({name:'Square continuous leg',shape:'chain',p:[0,0,0],s:[1,1,1],points,widths:(leg<2?PONY_RIG.fore:PONY_RIG.hind).widths,footUp});

// Zero-allocation writer for dynamic 4-point continuous legs (56 vertices/leg).
// Matches ponyPartMesh(ponyLegPart(points, leg, footUp)) vertex order & hard normals.
const _ringU=[-.5,.5,.5,-.5],_ringV=[-.5,-.5,.5,.5];
const _seg=new Float64Array(9),_rings=new Float64Array(48);
export const PONY_LEG_VERTEX_COUNT=56;
export function writePonyLegBuffers(outPos,outNorm,vertexOffset,points,leg,footUp=null){
  const widths=(leg<2?PONY_RIG.fore:PONY_RIG.hind).widths;
  // Reverse order: r=0 is foot (points[3]), r=3 is hip (points[0]).
  for(let j=0;j<3;j++){
    const a=points[3-j],b=points[2-j];
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz);
    const k=j*3;
    if(len>1e-8){_seg[k]=dx/len;_seg[k+1]=dy/len;_seg[k+2]=dz/len;}
    else{_seg[k]=0;_seg[k+1]=1;_seg[k+2]=0;}
  }
  for(let j=0;j<4;j++){
    let dx,dy,dz;
    if(j===0){
      dx=_seg[0];dy=_seg[1];dz=_seg[2];
      if(footUp){
        const sx=dx+footUp[0],sy=dy+footUp[1],sz=dz+footUp[2],l=Math.hypot(sx,sy,sz);
        if(l>1e-8){dx=sx/l;dy=sy/l;dz=sz/l;}
      }
    }else if(j===3){
      dx=_seg[6];dy=_seg[7];dz=_seg[8];
    }else{
      const k0=(j-1)*3,k1=j*3;
      dx=_seg[k0]+_seg[k1];dy=_seg[k0+1]+_seg[k1+1];dz=_seg[k0+2]+_seg[k1+2];
      const l=Math.hypot(dx,dy,dz);
      if(l>1e-8){dx/=l;dy/=l;dz/=l;}else{dx=_seg[k1];dy=_seg[k1+1];dz=_seg[k1+2];}
    }
    let xx=1-dx*dx,xy=-dx*dy,xz=-dx*dz,xl=Math.hypot(xx,xy,xz);
    if(xl>1e-8){xx/=xl;xy/=xl;xz/=xl;}else{xx=0;xy=0;xz=1;}
    const zx=xy*dz-xz*dy,zy=xz*dx-xx*dz,zz=xx*dy-xy*dx;
    const p=points[3-j],w=widths[3-j],base=j*12;
    for(let i=0;i<4;i++){
      const u=_ringU[i],v=_ringV[i],o=base+i*3;
      _rings[o]=p[0]+w*(u*xx+v*zx);
      _rings[o+1]=p[1]+w*(u*xy+v*zy);
      _rings[o+2]=p[2]+w*(u*xz+v*zz);
    }
  }
  let ptr=vertexOffset*3;
  for(let j=0;j<3;j++){
    const b0=j*12,b1=(j+1)*12;
    for(let i=0;i<4;i++){
      const n=(i+1)&3,o0=b0+i*3,o1=b1+i*3,o2=b0+n*3,o3=b1+n*3;
      const x0=_rings[o0],y0=_rings[o0+1],z0=_rings[o0+2];
      const x1=_rings[o1],y1=_rings[o1+1],z1=_rings[o1+2];
      const x2=_rings[o2],y2=_rings[o2+1],z2=_rings[o2+2];
      const x3=_rings[o3],y3=_rings[o3+1],z3=_rings[o3+2];
      outPos[ptr]=x0;outPos[ptr+1]=y0;outPos[ptr+2]=z0;
      outPos[ptr+3]=x1;outPos[ptr+4]=y1;outPos[ptr+5]=z1;
      outPos[ptr+6]=x2;outPos[ptr+7]=y2;outPos[ptr+8]=z2;
      outPos[ptr+9]=x3;outPos[ptr+10]=y3;outPos[ptr+11]=z3;
      // Diagonal cross product (v1-v2) x (v3-v0) gives symmetric outward normal.
      const ax=x1-x2,ay=y1-y2,az=z1-z2,bx=x3-x0,by=y3-y0,bz=z3-z0;
      let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,nl=Math.hypot(nx,ny,nz);
      if(nl>1e-12){nx/=nl;ny/=nl;nz/=nl;}else{nx=0;ny=1;nz=0;}
      for(let k=0;k<12;k+=3){outNorm[ptr+k]=nx;outNorm[ptr+k+1]=ny;outNorm[ptr+k+2]=nz;}
      ptr+=12;
    }
  }
  for(let c=0;c<2;c++){
    const b=c===0?0:36;
    const x0=_rings[b],y0=_rings[b+1],z0=_rings[b+2];
    const x1=_rings[b+3],y1=_rings[b+4],z1=_rings[b+5];
    const x2=_rings[b+6],y2=_rings[b+7],z2=_rings[b+8];
    const x3=_rings[b+9],y3=_rings[b+10],z3=_rings[b+11];
    outPos[ptr]=x0;outPos[ptr+1]=y0;outPos[ptr+2]=z0;
    outPos[ptr+3]=x1;outPos[ptr+4]=y1;outPos[ptr+5]=z1;
    outPos[ptr+6]=x2;outPos[ptr+7]=y2;outPos[ptr+8]=z2;
    outPos[ptr+9]=x3;outPos[ptr+10]=y3;outPos[ptr+11]=z3;
    const sgn=c===0?1:-1;
    const ax=x1-x0,ay=y1-y0,az=z1-z0,bx=x2-x0,by=y2-y0,bz=z2-z0;
    let nx=sgn*(ay*bz-az*by),ny=sgn*(az*bx-ax*bz),nz=sgn*(ax*by-ay*bx),nl=Math.hypot(nx,ny,nz);
    if(nl>1e-12){nx/=nl;ny/=nl;nz/=nl;}else{nx=0;ny=-sgn;nz=0;}
    for(let k=0;k<12;k+=3){outNorm[ptr+k]=nx;outNorm[ptr+k+1]=ny;outNorm[ptr+k+2]=nz;}
    ptr+=12;
  }
}
