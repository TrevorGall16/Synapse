interface PlayerPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { slug } = await params;

  return (
    <div className="flex h-screen items-center justify-center">
      <h1 className="text-2xl font-bold text-white">
        Player View for <span className="text-white/60">{slug}</span>
      </h1>
    </div>
  );
}
