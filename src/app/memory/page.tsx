import type { Metadata } from "next";
import { MemoryView } from "./_view";

export const metadata: Metadata = { title: "Memory" };

export default function MemoryPage() {
  return <MemoryView />;
}
