import { z } from "zod";
import { AppError } from "./domain";
const remoteId = z.string().regex(/^[A-Za-z0-9]+$/);
async function apify(path:string, token:string, body?:unknown) {
  const response=await fetch(`https://api.apify.com/v2/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok) throw new AppError("Instagram profile reading is temporarily unavailable. Please try again later.",503);
  return response.json();
}
export async function startProfileRead(username:string, token:string) {
  const result=await apify('actors/apify~instagram-profile-scraper/runs?timeout=120&maxTotalChargeUsd=0.01',token,{usernames:[username]});
  return z.object({data:z.object({id:remoteId})}).parse(result).data.id;
}
export async function readProfileResult(runId:string,token:string):Promise<unknown[]|null> {
  remoteId.parse(runId);
  const result=z.object({data:z.object({id:remoteId,status:z.string(),defaultDatasetId:remoteId.optional()})}).parse(await apify(`actor-runs/${runId}`,token)).data;
  if(result.id !== runId) throw new AppError("Profile reading could not be confirmed.",503);
  if(['READY','RUNNING','TIMING-OUT','ABORTING'].includes(result.status))return null;
  if(result.status!=='SUCCEEDED'||!result.defaultDatasetId)throw new AppError("We couldn’t read your profile. Make sure it is public, then try again.",422);
  const items=await apify(`datasets/${result.defaultDatasetId}/items?format=json&limit=2&fields=id,username,biography,private,followersCount,profilePicUrl,fullName`,token);
  if(!Array.isArray(items))throw new AppError("Profile reading could not be confirmed.",503);
  return items;
}
