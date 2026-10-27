import { Unsubscribe } from "../../../components/Unsubscribe";
export const metadata = {
  title: "Drive Max email preferences",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <Unsubscribe token={(await params).token} />;
}
