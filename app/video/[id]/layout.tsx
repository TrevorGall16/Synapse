/**
 * app/video/[id]/layout.tsx — Server layout.
 *
 * Exists purely to inject SEO metadata and JSON-LD for /video/[id] without
 * touching the existing "use client" page.tsx (which mounts TheaterMode).
 * Next.js renders nested layouts on the server regardless of the child's
 * client/server status, so metadata + structured data work here.
 *
 * Data source: lib/mock-posts.ts (server-safe — no zustand/IDB).
 * User-published posts live only in the client (IDB/zustand), so metadata
 * for those ids falls back to a generic title + description. Once posts
 * have a server-backed source, the fallback branch can query it.
 */

import type { Metadata, ResolvingMetadata } from "next";
import { findMockPostById, formatTag } from "@/lib/mock-posts";

interface RouteParams { id: string }

export async function generateMetadata(
  { params }: { params: Promise<RouteParams> },
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id } = await params;
  const post = findMockPostById(id);
  const url  = `/video/${id}`;

  if (!post) {
    return {
      title: "Video · Synapse",
      description: "Browse audio-synced visual edits on Synapse.",
      alternates: { canonical: url },
      robots: { index: false, follow: true }, // don't index unknown ids
    };
  }

  const title = `${post.title} — @${post.user.handle} · Synapse`;
  const description =
    post.description?.trim() ||
    `${post.title} by @${post.user.handle}. Tags: ${post.tags.map(formatTag).join(" ")}. Watch this audio-synced visual edit on Synapse.`;

  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: post.tags.map((t) => t.replace(/^#/, "")),
    openGraph: {
      type: "video.other",
      url,
      title,
      description,
      siteName: "Synapse",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function VideoLayout({
  params,
  children,
}: {
  params: Promise<RouteParams>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const post = findMockPostById(id);

  // JSON-LD VideoObject — only when we have real catalog data.
  const jsonLd = post && {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: post.title,
    description:
      post.description?.trim() ||
      `${post.title} by @${post.user.handle} on Synapse.`,
    uploadDate: post.createdAt ? new Date(post.createdAt).toISOString() : undefined,
    duration: post.duration,
    genre: post.tags.map((t) => t.replace(/^#/, "")),
    creator: {
      "@type": "Person",
      name: post.user.handle,
      url: `/profile/${post.user.handle}`,
    },
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: { "@type": "LikeAction" },
        userInteractionCount: post.likes,
      },
      {
        "@type": "InteractionCounter",
        interactionType: { "@type": "CommentAction" },
        userInteractionCount: post.comments,
      },
    ],
  };

  return (
    <>
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
