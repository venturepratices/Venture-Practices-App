import { requireMarketingPage } from "@/lib/marketing/page-gate";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireMarketingPage();
  return <>{children}</>;
}
