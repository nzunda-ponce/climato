import type { Metadata } from "next";
import OpportunityReportView from "@/components/OpportunityReportView";
export const metadata: Metadata = {
  title: "Informe de oportunidades · Climato",
  description:
    "Ventanas de uniformidad por zona, días aptos esperados y actualización automática de los pronósticos.",
};
export default function ReportPage() {
  return <OpportunityReportView />;
}
