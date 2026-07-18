import LiveBroadcast from '@/components/LiveBroadcast';

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ session?: string }>;
};

export default async function LivePage({ params, searchParams }: Props) {
  const { code } = await params;
  const { session } = await searchParams;
  return <LiveBroadcast code={code.toUpperCase()} sessionParam={session} />;
}
