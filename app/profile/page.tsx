import { redirect } from "next/navigation";

// Graceful alias: bare /profile redirects to the current user's profile.
// Until auth/user state is wired in, fall back to the "you" handle.
export default function ProfileIndexPage() {
  redirect("/profile/you");
}
