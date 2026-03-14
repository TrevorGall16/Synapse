import { RecipeCard } from "@/components/ui/recipe-card";

const MOCK_RECIPES = [
  { slug: "heavy-bass-strobe", title: "Heavy Bass Strobe", bpm: 140, intensity: "15Hz High", shaderComplexity: "Complex" },
  { slug: "deep-trance-pulse", title: "Deep Trance Pulse", bpm: 128, intensity: "10Hz Medium", shaderComplexity: "Medium" },
  { slug: "dark-spiral-sync", title: "Dark Spiral Sync", bpm: 160, intensity: "20Hz Extreme", shaderComplexity: "Complex" },
  { slug: "ambient-drift", title: "Ambient Drift", bpm: 90, intensity: "5Hz Low", shaderComplexity: "Simple" },
  { slug: "neon-flash-drop", title: "Neon Flash Drop", bpm: 150, intensity: "12Hz High", shaderComplexity: "Complex" },
  { slug: "slow-burn-loop", title: "Slow Burn Loop", bpm: 100, intensity: "8Hz Medium", shaderComplexity: "Medium" },
];

export default function Home() {
  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Discovery Feed</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_RECIPES.map((recipe) => (
          <RecipeCard key={recipe.slug} {...recipe} />
        ))}
      </div>
    </div>
  );
}
