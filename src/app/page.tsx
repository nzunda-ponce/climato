import PlanningWorkspace from "@/components/PlanningWorkspace";
export const dynamic = "force-dynamic";
export const metadata = { title: "Panel de resultados · Climato" };
export default function Page() {
  return (
    <PlanningWorkspace
      windyEnabled={Boolean(process.env.WINDY_MAP_API_KEY?.trim())}
    />
  );
}
