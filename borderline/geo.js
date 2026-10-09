const R=6371.0088, rad=Math.PI/180;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a);
const unit=a=>a.map(v=>v/norm(a));
const vec=([lon,lat])=>[Math.cos(lat*rad)*Math.cos(lon*rad),Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad)];
const angle=(a,b)=>Math.atan2(norm(cross(a,b)),dot(a,b));
export const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function nearest(point,geometry){
 const all=polygons(geometry);
 if(all.some(poly=>inside(point,poly[0])&&!poly.slice(1).some(r=>inside(point,r))))return {km:0,point};
 const p=vec(point);let best=Infinity, target;
 for(const poly of all)for(const ring of poly)for(let i=1;i<ring.length;i++){
  const a=vec(ring[i-1]),b=vec(ring[i]);let q=angle(p,a)<angle(p,b)?a:b;
  const n=cross(a,b), nn=norm(n);
  if(nn>1e-12){const u=n.map(x=>x/nn), projected=p.map((x,k)=>x-dot(p,u)*u[k]);if(norm(projected)>1e-12){const v=unit(projected);if(Math.abs(angle(a,v)+angle(v,b)-angle(a,b))<1e-8)q=v;}}
  const d=angle(p,q);if(d<best){best=d;target=[Math.atan2(q[1],q[0])/rad,Math.asin(q[2])/rad];}
 }
 return {km:best*R,point:target};
}
