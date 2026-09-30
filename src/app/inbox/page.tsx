import type { Metadata } from "next";
import { InboxView } from "./_view";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return <InboxView />;
}
