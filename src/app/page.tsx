import PlanningWorkspace from "@/components/PlanningWorkspace";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <PlanningWorkspace
      windyEnabled={Boolean(process.env.WINDY_MAP_API_KEY?.trim())}
    />
  );
}
