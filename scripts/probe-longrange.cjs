async function main(){
 for(const [name,base,params] of [
  ['seasonal','https://seasonal-api.open-meteo.com/v1/seasonal',{models:'ecmwf_seasonal_seamless',hourly:'wind_speed_10m,wind_gusts_10m,precipitation',start_date:'2026-10-16',end_date:'2026-12-31',timezone:'America/Argentina/Buenos_Aires'}],
  ['era5','https://archive-api.open-meteo.com/v1/archive',{models:'era5',hourly:'wind_speed_10m,wind_gusts_10m,precipitation',start_date:'1991-10-01',end_date:'1991-10-03',timezone:'America/Argentina/Buenos_Aires'}]
 ]){const u=new URL(base);Object.entries({latitude:'-34',longitude:'-63',...params}).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{signal:AbortSignal.timeout(90000)});const d=await r.json(); console.log(JSON.stringify({name,status:r.status,error:d.reason,time:d.hourly?.time?.slice(0,6),last:d.hourly?.time?.at(-1),keys:Object.keys(d.hourly??{}).slice(0,12),values:Object.fromEntries(Object.entries(d.hourly??{}).filter(([k])=>!k.includes('member')).map(([k,v])=>[k,{first:v.slice(0,5),valid:v.filter(x=>x!==null).length,last:v.slice(-4)}]))}));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
