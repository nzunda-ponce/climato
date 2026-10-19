import { readState } from "../src/persistence/store";
import { buildPlans } from "../src/domain/planning";
import { climatePotential } from "../src/domain/climatic";
import { localDate } from "../src/domain/types";
async function main(){let start=Date.now();const s=await readState();console.log(JSON.stringify({stage:"read",ms:Date.now()-start}));start=Date.now();const plans=buildPlans(s.pivots,s.forecasts,s.rules,s.ensembles,s.climate);console.log(JSON.stringify({stage:"plans",ms:Date.now()-start}));start=Date.now();const c=climatePotential(plans,s.rules,s.ensembles,s.climate,localDate(),Date.now(),s.seasonal);console.log(JSON.stringify({stage:"climate",ms:Date.now()-start,zones:c.zones.length}));}
main();
