import { DurableObject } from "cloudflare:workers"
type Env = { PROBE: DurableObjectNamespace<Probe> }
const nonce = "choose-a-private-probe-path"
export class Probe extends DurableObject<Env> {
 async one(count: number) {
  let ok=0; const errors:string[]=[]
  for(let n=0;n<count;n++) {
   try {
    const response=await fetch("https://example.com/",{redirect:"manual"})
    const body=await response.text()
    if(response.ok && body.includes("Example Domain"))ok++
    else errors.push(`request ${n}: status ${response.status}, invalid result`)
   } catch(error) {errors.push(`request ${n}: ${error instanceof Error?error.message:String(error)}`); break}
  }
  return {requested:count,ok,errors}
 }
 async group() {return await Promise.all([0,1,2].map(()=>this.env.PROBE.get(this.ctx.id).one(45)))}
 private active=0
 private peak=0
 async startOverlap(origin:string,serial=false) {
  this.active=0;this.peak=0
  await this.ctx.storage.delete(["o:0","o:1","o:2"])
  await this.ctx.storage.put("overlap",{next:0,origin,serial})
  await this.ctx.storage.setAlarm(Date.now()+100)
 }
 async overlapResult() {
  const rows=await this.ctx.storage.get(["o:0","o:1","o:2"])
  return {results:[...rows.values()],peak:this.peak,active:this.active}
 }
 async startAlarm() {await this.ctx.storage.setAlarm(Date.now()+100)}
 async alarm() {
  const plan=await this.ctx.storage.get<{next:number,origin:string,serial?:boolean}>("overlap")
  if(!plan){await this.ctx.storage.put("result",await this.group());return}
  const index=plan.next
  await this.ctx.storage.put("overlap",{...plan,next:index+1})
  this.active++;this.peak=Math.max(this.peak,this.active)
  const work=(async()=>{
   const held=await fetch(plan.origin+"/"+nonce+"/hold")
   await held.text()
   const result=await this.one(45)
   this.active--
   await this.ctx.storage.put("o:"+index,{index,...result})
  })()
  if(plan.serial){
   await work
   if(index<2)await this.ctx.storage.setAlarm(Date.now()+250)
  }else{
   if(index<2)await this.ctx.storage.setAlarm(Date.now()+100)
   this.ctx.waitUntil(work)
  }
 }
 async result() {return await this.ctx.storage.get("result")??null}
}
export default {
 async fetch(request:Request,env:Env) {
  const url=new URL(request.url)
  if(url.pathname.split("/")[1]!==nonce)return new Response("Not found",{status:404})
  if(url.pathname.endsWith("/hold")){await new Promise(resolve=>setTimeout(resolve,2500));return new Response("held")}
  const stub=env.PROBE.getByName("probe")
  const action=url.pathname.split("/")[2]
  if(action==="serial"){await stub.startOverlap(url.origin,true);return Response.json({scheduled:true})}
  if(action==="overlap"){await stub.startOverlap(url.origin);return Response.json({scheduled:true})}
  if(action==="overlap-result")return Response.json(await stub.overlapResult())
  if(action==="control")return Response.json(await stub.one(60))
  if(action==="self")return Response.json(await stub.group())
  if(action==="alarm") {await stub.startAlarm();return Response.json({scheduled:true})}
  if(action==="result")return Response.json(await stub.result())
  return new Response("Not found",{status:404})
 }
}
