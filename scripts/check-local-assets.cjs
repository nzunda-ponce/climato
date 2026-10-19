async function main() {
  const base = 'http://127.0.0.1:3000';
  const response = await fetch(base);
  const html = await response.text();
  console.log('Page', response.status);
  const assets = [...html.matchAll(/(?:src|href)="([^"\s]*\/_next\/[^"\s]*)"/g)].map(m => m[1]);
  for (const asset of [...new Set(assets)]) {
    const res = await fetch(new URL(asset, base));
    console.log(res.status, res.headers.get('content-type'), asset);
  }
  const campaign = await fetch(base + '/api/campaign?mode=climate');
  const data = await campaign.json();
  console.log('Campaign', campaign.status, 'equipment', data.plans?.length, 'zones', data.climatic?.zones.length, data.error ?? '');
  if (data.climatic) {
    const complete = data.climatic.zones.filter(zone => zone.days.length > 0 && zone.days.every(day => day.probability !== null));
    console.log(JSON.stringify({wind: data.rules.wind, rain: data.rules.rain, previousRain: data.rules.rain24Limit,
      completeZones: complete.length, equipmentWithData: complete.reduce((n, zone) => n + zone.pending, 0)}));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
