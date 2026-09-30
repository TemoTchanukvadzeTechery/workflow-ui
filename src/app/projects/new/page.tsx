import type { Metadata } from "next";
import { NewProjectView } from "./_view";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return <NewProjectView />;
}
