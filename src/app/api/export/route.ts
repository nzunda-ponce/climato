import { readState } from "@/persistence/store";
export async function GET() {
  const state = await readState({ validation: true });
  return new Response(JSON.stringify(state, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="climato-campaign.json"',
    },
  });
}
