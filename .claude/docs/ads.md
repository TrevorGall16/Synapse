Monetization, SEO & Compliance Specification: Synapse Interactive Hub
1. Purpose & Network Selection
Strategy: Pivot from standard AdSense to High-Risk/Adult Networks (Adsterra, ExoClick, TrafficStars) to match the target demographic.

Goal: Maximize revenue through a hybrid of Native Banners and CPA (Cost Per Action) Affiliate Buttons.

2. Ad Placements & Engine Safety
Native Discovery: Insert Adsterra "Native" units within the Discovery Hub grid. These must be styled to look like "Recommended Sessions".

The Right Panel: On the Studio and Player pages, ads are restricted to the right-hand sidebar. They must not interfere with the 5-track timeline or transport controls.

CLS Prevention: Every ad container requires a min-height: 250px in the CSS to prevent layout shifts during high-intensity sequences.

Context Protection (New Tab Rule): Clicking any CPA link or Ad must open in a target="_blank" new tab. This ensures the user's active session continues in the current tab without background tracking pixels interfering with the WebGPU memory or playback loop.

3. Creator Economy & Affiliate Strategy
The "Support" Button: Next to every embedded trailer or recipe, place a high-visibility button: "Support this Creator / See Full Video".

Visual Trust: Style these buttons using the brand colors of the target platforms (e.g., OnlyFans Blue, Fansly) to reduce user friction.

Affiliate Link Hijacking Prevention: The root_affiliate_link is hardcoded to the original creator's account in the .SYNAPSE JSON. If the recipe is remixed by another user, the original creator's link remains locked. The remixer can only add their link to the secondary remixer_link slot, ensuring the original author always gets credited/paid.

4. Legal Compliance & Safe Harbor Protocols
DMCA / Section 2257 Liability: Synapse acts strictly as a "Software Utility" or Secondary Service Provider. Because the user provides the "Fuel" (Local Media) and Synapse never touches, uploads, or stores it, the platform maintains legal Safe Harbor status.

Age Verification Inheritance: Synapse will not implement its own invasive age gates. Instead, it will Inherit the Gate. If an external embed (like RedGIFs) requires an age-gate click, the user must click it within the strictly sandboxed iframe. Synapse does not store this metadata.

Export Liability (Strobe Safety Check): Before the final MP4 Bake begins, the UI must force the user to manually check a box: "I understand this exported video contains high-intensity flashing visuals." This legally protects the platform from epilepsy-related liabilities regarding exported media.

5. Technical SEO & Indexing
No "Word Walls": The static 500-word block is removed. SEO value is instead generated programmatically through dynamic Metadata Badges on recipe pages (e.g., Intensity, Tags, BPM, Shader Complexity).

Clean URLs: Every session uses a unique, lowercase, hyphenated slug (e.g., /session/heavy-latex-strobe) to ensure indexability.

Metadata Bridge: The app must dynamically update document.title and meta tags using the Next.js Metadata API for every individual recipe page to ensure rich social-sharing cards (Twitter/Discord embeds).