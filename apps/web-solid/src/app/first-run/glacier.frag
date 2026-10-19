precision highp float;
uniform vec2 r;
uniform float t;
uniform float d;
const vec3 cB=vec3(.025,.045,.065),cT=vec3(.06,.11,.16),cG=vec3(.2,.31,.42),cF1=vec3(.3,.41,.5),cF2=vec3(.14,.2,.26);
float h2(vec2 p){
  return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
}
float n2(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+1.),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  for(int i=0;i<4;i++){
    v+=a*n2(p);
    p=p*2.03+vec2(1.7,9.2);
    a*=.5;
  }
  return v;
}
float b2(vec2 a){
  a=floor(a);
  return fract(a.x/2.+a.y*a.y*.75);
}
float b4(vec2 a){
  return b2(.5*a)*.25+b2(a);
}
float b8(vec2 a){
  return b4(.5*a)*.25+b2(a);
}
float snow(vec2 p,float sc,float sp,float sz,float soft,float dens){
  vec2 q=p*sc;
  q.y+=t*sp;
  q.x+=t*.015+sin(q.y*.35+t*.2)*.3;
  vec2 id=floor(q);
  vec2 f=fract(q)-.5;
  float h=h2(id);
  vec2 o=(vec2(h2(id+1.3),h2(id+2.7))-.5)*.6;
  float s=sz*(.6+.8*h2(id+4.1));
  return step(h,dens)*(1.-smoothstep(s*soft,s,length(f-o)))*(.5+.5*h2(id+5.));
}
float smoke(vec2 p,float sp){
  vec2 q=p*vec2(1.4,1.)+vec2(0.,-t*sp);
  vec2 w=vec2(fbm(q+vec2(0.,t*.015)),fbm(q+vec2(4.3,1.7)-t*.01));
  return fbm(q*1.1+w*1.4);
}
float stars(vec2 p,float sc,float dens){
  vec2 q=p*sc;
  vec2 id=floor(q);
  vec2 f=fract(q)-.5;
  float h=h2(id);
  vec2 o=(vec2(h2(id+1.1),h2(id+2.2))-.5)*.7;
  return step(h,dens)*(1.-smoothstep(0.,.06,length(f-o)))*(.6+.4*sin(t*(.5+h)+h*30.));
}
float sparkle(vec2 p,float sc,float dens){
  vec2 q=p*sc;
  vec2 id=floor(q);
  vec2 f=fract(q)-.5;
  float h=h2(id+9.);
  f-=(vec2(h2(id+3.1),h2(id+4.2))-.5)*.5;
  float c=max((1.-smoothstep(0.,.012,abs(f.x)))*(1.-smoothstep(0.,.16,abs(f.y))),(1.-smoothstep(0.,.012,abs(f.y)))*(1.-smoothstep(0.,.16,abs(f.x))));
  return step(h,dens)*c*(.55+.45*sin(t*.9+h*40.));
}
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  float a=r.x/r.y;
  vec2 p=vec2(uv.x*a,uv.y);
  vec2 px=floor(gl_FragCoord.xy/(2.*d));
  float y=uv.y;
  vec3 col=mix(cB,cT,y);
  float g=exp(-2.4*length(p-vec2(a*.66,.98)));
  col=mix(col,cG,floor(g*5.+b8(px))/5.*.5);
  float sky=smoothstep(.3,.85,y);
  col+=vec3(.92,.94,1.)*(stars(p,30.,.2)*.6+stars(p,60.,.14)*.3+sparkle(p,8.,.08)*.7)*sky;
  float fogT=0.;
  for(int i=0;i<3;i++){
    float k=float(i);
    float f=smoke(p*(.8+k*.28)+vec2(k*3.1,0.),.01+k*.007);
    float h=(1.-smoothstep(.02,.66-k*.14,y));
    float m=clamp(smoothstep(.32,.74,f)*h*1.5,0.,1.);
    fogT=max(fogT,m);
    col*=1.-.18*(1.-smoothstep(0.,.34,y))*(k+1.)/3.;
    col=mix(col,mix(cF1,cF2,k/2.),m*(.68-k*.1));
  }
  col*=1.-.45*(1.-smoothstep(0.,.16,y));
  col+=vec3(.9,.92,.96)*(snow(p,24.,.2,.06,.3,.12)*.2+snow(p,10.,.32,.07,.2,.09)*.25)*(1.-fogT*.5);
  col*=1.-.22*length(uv-vec2(.5,.62));
  col+=(h2(gl_FragCoord.xy+fract(t*7.))-.5)*.01;
  gl_FragColor=vec4(col,1.);
}
