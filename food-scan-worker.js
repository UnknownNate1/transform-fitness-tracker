const ALLOWED_ORIGIN = "https://unknownnate1.github.io";
const MODEL = "gemini-3.5-flash-lite";
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Vary":"Origin"}});
export default {
 async fetch(request, env) {
  const origin=request.headers.get("Origin")||"";
  if(origin!==ALLOWED_ORIGIN) return json({error:"Origin not allowed."},403);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, X-Transform-Passcode","Access-Control-Max-Age":"86400","Vary":"Origin"}});
  if(request.method!=="POST") return json({error:"Use POST."},405);
  if(!env.GEMINI_API_KEY||!env.APP_PASSCODE){const missing=[!env.GEMINI_API_KEY?"GEMINI_API_KEY":null,!env.APP_PASSCODE?"APP_PASSCODE":null].filter(Boolean);return json({error:"Scanner backend is missing: "+missing.join(", ")+".",missing},503);}
  if(request.headers.get("X-Transform-Passcode")!==env.APP_PASSCODE) return json({error:"Incorrect scanner access code."},401);
  const length=Number(request.headers.get("Content-Length")||0);
  if(length>6_000_000) return json({error:"Photo is too large. Try a smaller image."},413);
  let body;
  try { body=await request.json(); } catch { return json({error:"Invalid request."},400); }
  if(typeof body.imageBase64!=="string"||body.imageBase64.length>5_500_000||body.mimeType!=="image/jpeg") return json({error:"Send a JPEG photo under about 4 MB."},400);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(body.imageBase64)) return json({error:"Invalid image data."},400);
  const prompt="You are estimating nutrition from a meal photo. Identify visible foods and estimate the edible portion size. Use the user's note only as additional context: "+String(body.notes||"").slice(0,240)+". Return JSON only with keys foodName (string), portion (string), calories (integer kcal), protein_g (number), carbs_g (number), fat_g (number), confidence (low/medium/high), notes (short uncertainty note). Estimate the visible serving only. Do not claim exactness. If food or portion is unclear, use conservative estimates and confidence low. Nutrition values must be nonnegative.";
  try {
   const upstream=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+MODEL+":generateContent",{
    method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},
    body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:"image/jpeg",data:body.imageBase64}}]}],generationConfig:{responseMimeType:"application/json",temperature:0.2,maxOutputTokens:500}})
   });
   const payload=await upstream.json();
   if(!upstream.ok) {
    const detail=String(payload?.error?.message||"No additional details returned by Gemini.").replace(/[\\r\\n]+/g," ").slice(0,300);
    return json({error:"Gemini API error (HTTP "+upstream.status+"): "+detail},502);
   }
   const raw=payload.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
   const result=JSON.parse(raw);
   const out={foodName:String(result.foodName||"Meal").slice(0,100),portion:String(result.portion||"1 serving").slice(0,100),calories:Number(result.calories),protein_g:Number(result.protein_g),carbs_g:Number(result.carbs_g),fat_g:Number(result.fat_g),confidence:["low","medium","high"].includes(result.confidence)?result.confidence:"low",notes:String(result.notes||"Photo-based estimate; ingredients and portion size may be uncertain.").slice(0,240)};
   if(![out.calories,out.protein_g,out.carbs_g,out.fat_g].every(Number.isFinite)||out.calories<0||out.calories>5000||out.protein_g<0||out.protein_g>300||out.carbs_g<0||out.carbs_g>500||out.fat_g<0||out.fat_g>300) throw new Error("Invalid nutrition estimate");
   return json(out);
  } catch(e) { const detail=String(e?.message||"Unknown processing error").replace(/[\\r\\n]+/g," ").slice(0,240); return json({error:"Scanner processing error: "+detail},422); }
 }
};