import Link from "next/link";

interface RecipeCardProps {
  slug: string;
  title: string;
  bpm: number;
  intensity: string;
  shaderComplexity: string;
}

export function RecipeCard({
  slug,
  title,
  bpm,
  intensity,
  shaderComplexity,
}: RecipeCardProps) {
  return (
    <Link href={`/session/${slug}`}>
      <div className="group cursor-pointer overflow-hidden rounded-lg border-t border-white/20 bg-[#222222] transition-colors hover:bg-[#2a2a2a]">
        {/* Thumbnail placeholder */}
        <div className="aspect-video w-full bg-[#2e2e2e]" />

        <div className="flex flex-col gap-2 p-3">
          <h3 className="text-sm font-medium text-white">{title}</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge label={`${bpm} BPM`} />
            <Badge label={intensity} />
            <Badge label={shaderComplexity} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">
      {label}
    </span>
  );
}
