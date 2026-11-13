import { DealsDashboard } from "@/components/deals-dashboard";
import { loadDeals } from "@/lib/deals";
import { loadSourceStatuses, loadStoreProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await loadStoreProfile();
  const [offers, sourceStatuses] = await Promise.all([loadDeals(profile), loadSourceStatuses(profile)]);
  return <DealsDashboard offers={offers} initialProfile={profile} sourceStatuses={sourceStatuses} />;
}
