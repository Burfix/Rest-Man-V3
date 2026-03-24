import Sidebar from "@/components/dashboard/Sidebar";
import UserProfile from "@/components/dashboard/UserProfile";
import ThemeToggle from "@/components/dashboard/ThemeToggle";

export const metadata = {
  title: "ForgeStack Operating Brain",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-stone-50 dark:bg-[#0f0f0e]">
      <Sidebar footer={
        <div>
          <ThemeToggle />
          <UserProfile />
        </div>
      } />
      {/* pt-14 reserves space for the fixed mobile top bar; lg:pt-0 removes it on desktop */}
      <main className="flex-1 overflow-y-auto p-4 pt-[72px] lg:p-8 lg:pt-8 bg-stone-50 dark:bg-[#0f0f0e]">
        {children}
      </main>
    </div>
  );
}
