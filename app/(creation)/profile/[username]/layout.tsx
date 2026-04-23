/**
 * app/profile/[username]/layout.tsx — Server layout.
 *
 * Injects SEO metadata + ProfilePage JSON-LD without touching the existing
 * client page.tsx (897 lines of TheaterMode / grid / batch-edit logic).
 *
 * Creator data comes from lib/mock-posts.ts. For the "you" route (owner's
 * own profile) metadata is intentionally generic — the real profile name
 * lives client-side in zustand/IDB and isn't safe to read here.
 */

import type { Metadata, ResolvingMetadata } from "next";
import { findMockCreator } from "@/lib/mock-posts";
import { getCanonicalBaseUrl, absoluteUrl } from "@/lib/canonical";

interface RouteParams { username: string }

export async function generateMetadata(
  { params }: { params: Promise<RouteParams> },
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { username } = await params;
  const url = `/profile/${username}`;
  const creator = findMockCreator(username);
  const base = getCanonicalBaseUrl();

  if (username === "you") {
    return {
      metadataBase: new URL(base),
      title: "Your Profile · Synapse",
      description: "Your published edits, drafts, and stats on Synapse.",
      alternates: { canonical: url },
      robots: { index: false, follow: false },
    };
  }

  if (!creator) {
    // Unknown username — still render, but do not index until backed by data.
    return {
      metadataBase: new URL(base),
      title: `@${username} · Synapse`,
      description: `Edits and recipes by @${username} on Synapse.`,
      alternates: { canonical: url },
      robots: { index: false, follow: true },
    };
  }

  const title = `${creator.displayName} (@${username}) · Synapse`;
  const description = `${creator.bio} — ${creator.postCount} edits, ${creator.followers.toLocaleString()} followers, ${creator.totalLikes.toLocaleString()} total likes.`;

  return {
    metadataBase: new URL(base),
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      url,
      title,
      description,
      username,
      siteName: "Synapse",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ProfileLayout({
  params,
  children,
}: {
  params: Promise<RouteParams>;
  children: React.ReactNode;
}) {
  const { username } = await params;
  const creator = findMockCreator(username);

  // BreadcrumbList — Home → Creators → @username. Emitted for any non-"you" route.
  const breadcrumbs = username !== "you" && {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home",     item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Creators", item: absoluteUrl("/browse") },
      { "@type": "ListItem", position: 3, name: `@${username}`, item: absoluteUrl(`/profile/${username}`) },
    ],
  };

  const jsonLd = creator && username !== "you" && {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: creator.displayName,
      alternateName: `@${username}`,
      description: creator.bio,
      url: `/profile/${username}`,
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: { "@type": "FollowAction" },
          userInteractionCount: creator.followers,
        },
        {
          "@type": "InteractionCounter",
          interactionType: { "@type": "LikeAction" },
          userInteractionCount: creator.totalLikes,
        },
      ],
    },
  };

  return (
    <>
      {breadcrumbs && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
        />
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
