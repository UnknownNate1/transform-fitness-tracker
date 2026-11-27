const ALLOWED_ORIGIN = "https://unknownnate1.github.io";
const MODEL = "gemini-3.5-flash-lite";
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Vary":"Origin"}});
function mergeRecords(oldList,newList,deleted){
 const map=new Map();
 for(const item of [...(Array.isArray(oldList)?oldList:[]),...(Array.isArray(newList)?newList:[])]) {
  if(!item||!item.id||deleted.has(item.id)) continue;
  const current=map.get(item.id);
  if(!current||String(item.updatedAt||"")>=String(current.updatedAt||"")) map.set(item.id,item);
 }
 return [...map.values()];
}
export default {
 async scheduled(controller, env, ctx) {
  if(!env.TRANSFORM_DB)return;
  try{
   const row=await env.TRANSFORM_DB.prepare("SELECT data_json FROM transform_data WHERE user_key = ?").bind("main").first();
   if(!row)return;
   const data=JSON.parse(row.data_json);
   const days=Number(data.trashRetentionDays??30);
   if(!days)return;
   const cutoff=Date.now()-days*86400000;
   const keep=[];
   const deleted=new Set(Array.isArray(data.deletedIds)?data.deletedIds:[]);
   for(const item of Array.isArray(data.trash)?data.trash:[]){
    if(Date.parse(item.deletedAt||"")<cutoff){if(item.id)deleted.add(item.id)}else keep.push(item);
   }
   if(keep.length!==(data.trash||[]).length){
    data.trash=keep;data.deletedIds=[...deleted];
    await env.TRANSFORM_DB.prepare("UPDATE transform_data SET data_json = ?, updated_at = ? WHERE user_key = ?").bind(JSON.stringify(data),new Date().toISOString(),"main").run();
   }
  }catch(error){console.error("Scheduled TRANSFORM cleanup failed",error)}
 },
 async fetch(request, env) {
  const origin=request.headers.get("Origin")||"";
  if(origin!==ALLOWED_ORIGIN) return json({error:"Origin not allowed."},403);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, X-Transform-Passcode","Access-Control-Max-Age":"86400","Vary":"Origin"}});
  if(request.method!=="POST") return json({error:"Use POST."},405);
  if(!env.APP_PASSCODE) return json({error:"Worker is missing APP_PASSCODE."},503);
  if(request.headers.get("X-Transform-Passcode")!==env.APP_PASSCODE) return json({error:"Incorrect scanner access code."},401);
  const length=Number(request.headers.get("Content-Length")||0);
  if(length>6_000_000) return json({error:"Request is too large."},413);
  let body;
  try { body=await request.json(); } catch { return json({error:"Invalid request."},400); }
  if(body.action==="sync"){
   if(!env.TRANSFORM_DB) return json({error:"Shared storage is not connected yet. Add the TRANSFORM_DB database binding to this Worker."},503);
   if(!body.data||typeof body.data!=="object") return json({error:"No tracker data was supplied."},400);
   try{
    const incoming=body.data;
    for(const key of ["weights","workouts","nutrition"]) if(!Array.isArray(incoming[key])) incoming[key]=[];
    const found=await env.TRANSFORM_DB.prepare("SELECT data_json FROM transform_data WHERE user_key = ?").bind("main").first();
    const previous=found?JSON.parse(found.data_json):{};
    const deleted=new Set([...(Array.isArray(previous.deletedIds)?previous.deletedIds:[]),...(Array.isArray(incoming.deletedIds)?incoming.deletedIds:[])]);const trashMap=new Map();for(const item of [...(Array.isArray(previous.trash)?previous.trash:[]),...(Array.isArray(incoming.trash)?incoming.trash:[])]){if(!item||!item.id||deleted.has(item.id))continue;const old=trashMap.get(item.id);if(!old||String(item.deletedAt||"")>=String(old.deletedAt||""))trashMap.set(item.id,item)}
    const trashedIds=new Set([...trashMap.values()].filter(t=>{const active=[...(Array.isArray(previous.weights)?previous.weights:[]),...(Array.isArray(incoming.weights)?incoming.weights:[]),...(Array.isArray(previous.workouts)?previous.workouts:[]),...(Array.isArray(incoming.workouts)?incoming.workouts:[]),...(Array.isArray(previous.nutrition)?previous.nutrition:[]),...(Array.isArray(incoming.nutrition)?incoming.nutrition:[])].filter(r=>r&&r.id===t.id).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));return !active.length||String(t.deletedAt||"")>String(active[0].updatedAt||"")}).map(t=>t.id));
    const archiveMap=new Map();for(const item of [...(Array.isArray(previous.archive)?previous.archive:[]),...(Array.isArray(incoming.archive)?incoming.archive:[])]){if(!item||!item.id||deleted.has(item.id))continue;const old=archiveMap.get(item.id);if(!old||String(item.archivedAt||"")>=String(old.archivedAt||""))archiveMap.set(item.id,item)}
    const activeCandidates=[...(previous.weights||[]),...(incoming.weights||[]),...(previous.workouts||[]),...(incoming.workouts||[]),...(previous.nutrition||[]),...(incoming.nutrition||[])];
    const archivedIds=new Set([...archiveMap.values()].filter(a=>{const active=activeCandidates.filter(r=>r&&r.id===a.id).sort((x,y)=>String(y.updatedAt||"").localeCompare(String(x.updatedAt||"")));return !active.length||String(a.archivedAt||"")>String(active[0].updatedAt||"")}).map(a=>a.id));
    const recoveryMap=new Map();for(const item of [...(Array.isArray(previous.recovery)?previous.recovery:[]),...(Array.isArray(incoming.recovery)?incoming.recovery:[])]){if(!item||!item.id||deleted.has(item.id))continue;const old=recoveryMap.get(item.id);if(!old||String(item.recoveryAt||'')>=String(old.recoveryAt||''))recoveryMap.set(item.id,item)}
    const recoveryDays=Number(incoming.recoveryRetentionDays??previous.recoveryRetentionDays??30),recoveryCutoff=recoveryDays?Date.now()-recoveryDays*86400000:0;for(const [id,item] of recoveryMap){if(recoveryDays&&Date.parse(item.recoveryAt||'')<recoveryCutoff){deleted.add(id);recoveryMap.delete(id)}}
    const merged={
     weights:mergeRecords(previous.weights,incoming.weights,deleted).filter(x=>!trashedIds.has(x.id)&&!archivedIds.has(x.id)),
     workouts:mergeRecords(previous.workouts,incoming.workouts,deleted).filter(x=>!trashedIds.has(x.id)&&!archivedIds.has(x.id)),
     nutrition:mergeRecords(previous.nutrition,incoming.nutrition,deleted).filter(x=>!trashedIds.has(x.id)&&!archivedIds.has(x.id)),
     trash:[...trashMap.values()].filter(t=>trashedIds.has(t.id)),archive:[...archiveMap.values()].filter(a=>archivedIds.has(a.id)),recovery:[...recoveryMap.values()],deletedIds:[...deleted],trashRetentionDays:incoming.trashRetentionDays??previous.trashRetentionDays??30,recoveryRetentionDays:incoming.recoveryRetentionDays??previous.recoveryRetentionDays??30,defaultRecordDestination:incoming.defaultRecordDestination??previous.defaultRecordDestination??"ask",
     water:{...(previous.water||{}),...(incoming.water||{})},
     start:incoming.start??previous.start??210,
     goal:incoming.goal??previous.goal??155,
     height:incoming.height??previous.height??""
    };
    for(const day of Object.keys(merged.water)) merged.water[day]=Math.max(Number(previous.water?.[day]||0),Number(incoming.water?.[day]||0));
    await env.TRANSFORM_DB.prepare("INSERT INTO transform_data (user_key,data_json,updated_at) VALUES (?,?,?) ON CONFLICT(user_key) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at").bind("main",JSON.stringify(merged),new Date().toISOString()).run();
    return json({data:merged,syncedAt:new Date().toISOString()});
   }catch(e){return json({error:"Shared storage error: "+String(e?.message||"database operation failed").slice(0,180)},500)}
  }
  if(!env.GEMINI_API_KEY) return json({error:"Scanner backend is missing GEMINI_API_KEY."},503);
  if(typeof body.imageBase64!=="string"||body.imageBase64.length>5_500_000||body.mimeType!=="image/jpeg") return json({error:"Send a JPEG photo under about 4 MB."},400);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(body.imageBase64)) return json({error:"Invalid image data."},400);
  const prompt="You are estimating nutrition from a meal photo. Identify visible foods and estimate the edible portion size. Use the user's note only as additional context: "+String(body.notes||"").slice(0,240)+". Return JSON only with keys foodName (string), portion (string), calories (integer kcal), protein_g (number), carbs_g (number), fat_g (number), confidence (low/medium/high), notes (short uncertainty note). Estimate the visible serving only. Do not claim exactness. If food or portion is unclear, use conservative estimates and confidence low. Nutrition values must be nonnegative.";
  try {
   const upstream=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+MODEL+":generateContent",{
    method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},
    body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:"image/jpeg",data:body.imageBase64}}]}],generationConfig:{responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{foodName:{type:"STRING"},portion:{type:"STRING"},calories:{type:"NUMBER"},protein_g:{type:"NUMBER"},carbs_g:{type:"NUMBER"},fat_g:{type:"NUMBER"},confidence:{type:"STRING",enum:["low","medium","high"]},notes:{type:"STRING"}},required:["foodName","portion","calories","protein_g","carbs_g","fat_g","confidence","notes"]},temperature:0.2,maxOutputTokens:500}})
   });
   const payload=await upstream.json();
   if(!upstream.ok){const detail=String(payload?.error?.message||"No additional details returned by Gemini.").replace(/[\r\n]+/g," ").slice(0,300);return json({error:"Gemini API error (HTTP "+upstream.status+"): "+detail},502)}
   const raw=payload.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
   const result=JSON.parse(raw);
   const out={foodName:String(result.foodName||"Meal").slice(0,100),portion:String(result.portion||"1 serving").slice(0,100),calories:Number(result.calories),protein_g:Number(result.protein_g),carbs_g:Number(result.carbs_g),fat_g:Number(result.fat_g),confidence:["low","medium","high"].includes(result.confidence)?result.confidence:"low",notes:String(result.notes||"Photo-based estimate; ingredients and portion size may be uncertain.").slice(0,240)};
   const invalid=[];for(const [k,v,max] of [["calories",out.calories,5000],["protein_g",out.protein_g,300],["carbs_g",out.carbs_g,500],["fat_g",out.fat_g,300]]) if(!Number.isFinite(v)||v<0||v>max) invalid.push(k+"="+String(v));
   if(invalid.length) throw new Error("Invalid nutrition estimate: "+invalid.join(", "));
   return json(out);
  }catch(e){const detail=String(e?.message||"Unknown processing error").replace(/[\r\n]+/g," ").slice(0,240);return json({error:"Scanner processing error: "+detail},422)}
 }
};