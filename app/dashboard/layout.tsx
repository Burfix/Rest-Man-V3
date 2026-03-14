import Sidebar from "@/components/dashboard/Sidebar";
import UserProfile from "@/components/dashboard/UserProfile";

export const metadata = {
  title: "Dashboard — Si Cantina Sociale",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-stone-50">
      <Sidebar footer={<UserProfile />} />
      {/* pt-14 reserves space for the fixed mobile top bar; lg:pt-0 removes it on desktop */}
      <main className="flex-1 overflow-y-auto p-4 pt-[72px] lg:p-8 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
