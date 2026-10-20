import { RoomDirectory } from "../src/room/directory"
import { Room } from "../src/room/room-do"
import { sqlStorage } from "./sql-shim"
import type { OwnerServices } from "../src/owner/services"

export function roomDirectory(sql:SqlStorage){
 const rooms=new Map<string,Room>()
 const services={room:(roomId:string)=>{
  let room=rooms.get(roomId)
  if(!room){
   const roomSql=sqlStorage()
   const storage={sql:roomSql,transactionSync:<T>(f:()=>T)=>f()} as DurableObjectStorage
   room=new Room({ctx:{storage,id:{name:`room:owner:${roomId}`}} as DurableObjectState,sql:roomSql,env:{} as never,services:services as unknown as OwnerServices,broadcast:()=>{}})
   rooms.set(roomId,room)
  }
  return room
 }}
 return new RoomDirectory(sql,services as unknown as OwnerServices)
}
