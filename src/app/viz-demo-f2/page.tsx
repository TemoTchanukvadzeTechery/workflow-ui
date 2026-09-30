"use client";

// THROWAWAY (F2): visual check of src/components/viz against docs/design/reference. Delete before finishing.
import type { ReactNode } from "react";
import { openCommandPalette } from "@/components/shell/palette-store";
import { DotMatrix, FunnelColumns, MeshInsightCard, PromptBand, StepAreaChart } from "@/components/viz";

const CARD =
  "rounded-[28px] bg-[linear-gradient(180deg,#FAFAFA,#F6F6F6)] shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_0_0_1px_rgba(0,0,0,.035),0_1px_2px_rgba(0,0,0,.03),0_16px_36px_-18px_rgba(0,0,0,.10)] dark:bg-[linear-gradient(180deg,#18191C,#141518)] dark:shadow-[0_0_0_1px_rgba(255,255,255,.06)]";

function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`${CARD} ${className ?? ""}`}>
      {title && (
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="text-[21px] leading-tight font-medium tracking-[-0.015em]">{title}</h2>
          <span className="inline-flex size-11 items-center justify-center rounded-full border border-[#DADADA] dark:border-white/14">···</span>
        </div>
      )}
      {children}
    </section>
  );
}

const funnel = [
  { key: "a", label: "Initiated Payments", value: 65200, display: "65.2k" },
  { key: "b", label: "Authorized Payments", value: 54800, display: "54.8k" },
  { key: "c", label: "Successful Payments", value: 48600, display: "48.6k" },
  { key: "d", label: "Payouts to Merchants", value: 38300, display: "38.3k" },
  { key: "e", label: "Completed Transactions", value: 32900, display: "32.9k" },
];
const retention = [18, 16, 22, 22, 35, 35, 35, 30, 32, 42, 46, 48, 40, 47, 21, 26, 24].map((v, i) => ({ label: `W${i + 1}`, value: v }));

export default function VizDemo() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_450px]">
      <Card title="Payments" className="overflow-hidden pb-1">
        <div className="px-6 pt-6">
          <FunnelColumns
            columns={funnel}
            defaultActiveKey="c"
            height={172}
            max={72000}
            baseline={27000}
            axis={[
              { value: 70000, label: "70k" },
              { value: 60000, label: "60k" },
              { value: 50000, label: "50k" },
              { value: 40000, label: "40k" },
              { value: 30000, label: "30k" },
            ]}
            tooltip={(c) => [
              { value: c.display, label: "transactions" },
              { value: "89%", label: "Conversion", labelFirst: true },
              { value: "-11%", label: "Drop-off", labelFirst: true },
            ]}
          />
        </div>
        <PromptBand
          className="relative mx-0.5 -mt-3"
          title="What would you like to explore next?"
          placeholder="I want to know what caused the drop-off"
          suggestions={[
            { token: "/successful payments", label: "Successful payments" },
            { token: "/inbox", label: "Open the inbox", href: "/inbox" },
          ]}
          onSubmit={(t) => openCommandPalette(t)}
        />
      </Card>
      <Card title="Insights (mesh below)">
        <div className="p-6 text-[14px] text-[#6E6E6E]">Gross Volume stand-in.</div>
      </Card>
      <div className="grid gap-4 lg:col-span-2 lg:grid-cols-[336px_minmax(0,1fr)_450px]">
        <Card title="Retention">
          <div className="px-6 pt-4 pb-6">
            <StepAreaChart data={retention} highlightIndex={9} chipLabel="42%" xLabels={["Jan", "Feb", "Mar", "Apr", "May", "Jun"]} height={250} formatValue={(v) => `${v}%`} />
          </div>
        </Card>
        <div className="grid gap-4">
          <Card title="Transactions">
            <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-2 pb-6">
              <div className="text-[52px] leading-none tracking-[-0.04em]">106k</div>
              <DotMatrix columns={[3, 3, 7, 3, 3, 2, 2]} labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} tone="green" />
              <div className="text-right">
                <div className="text-[16px] text-[#8A8A8A]">vs last period</div>
                <div className="mt-2 text-[22px]">+34,002</div>
              </div>
            </div>
          </Card>
          <Card title="Customers">
            <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-2 pb-6">
              <div className="text-[52px] leading-none tracking-[-0.04em]">1,284</div>
              <DotMatrix columns={[2, 2, 3, 5, 7, 2, 3, 2]} labels={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} peakLabel="Highest" tone="blue" />
              <div className="text-right">
                <div className="text-[16px] text-[#8A8A8A]">vs last period</div>
                <div className="mt-2 text-[22px]">+320</div>
              </div>
            </div>
          </Card>
        </div>
        <MeshInsightCard
          intervalMs={4000}
          items={[
            { value: "75%", title: "Authorization rate increased by 4% compared to last week.", body: "This improvement reduced failed transactions by 950 and is projected to recover $12,400." },
            { value: "3", title: "Tasks are waiting for your review.", href: "/inbox" },
            { value: "$4.20", title: "Average agent spend per approved task." },
          ]}
        />
      </div>
    </div>
  );
}
