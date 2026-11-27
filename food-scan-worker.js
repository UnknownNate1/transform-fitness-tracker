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
    const deleted=new Set([...(Array.isArray(previous.deletedIds)?previous.deletedIds:[]),...(Array.isArray(incoming.deletedIds)?incoming.deletedIds:[])]);
    const merged={
     weights:mergeRecords(previous.weights,incoming.weights,deleted),
     workouts:mergeRecords(previous.workouts,incoming.workouts,deleted),
     nutrition:mergeRecords(previous.nutrition,incoming.nutrition,deleted),
     deletedIds:[...deleted],
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