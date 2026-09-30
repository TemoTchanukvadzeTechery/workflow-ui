import { PageSkeleton } from "@/components/common/skeletons";

/**
 * Shown while this route's server component resolves. Loading boundaries live only on leaf
 * routes: one above a layout or page that calls notFound() would stream a 200 before the 404.
 */
export default function Loading() {
  return <PageSkeleton />;
}
