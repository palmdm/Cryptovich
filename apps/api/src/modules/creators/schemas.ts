import { z } from "zod";
import { AVATAR_FRAMES, CUSTOM_FRAME_PATTERN, isCountryCode, isSafeHttpUrl, parseSpotifyUrl } from "@platform/shared";

// `z.string().url()` alone accepts `javascript:` and `data:` URLs, which
// become stored XSS the moment one is rendered into an href or src.
// `isSafeHttpUrl` narrows every user-supplied URL to http/https.
const httpUrl = () =>
  z.string().url().refine(isSafeHttpUrl, { message: "Use an http or https URL." });

export const becomeCreatorSchema = z.object({
  displayName: z.string().min(1).max(80),
  bio: z.string().max(2000).optional(),
});

export const updateCreatorProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(2000).optional(),
  avatarUrl: httpUrl().optional(),
  // A decoration drawn around the avatar — a preset's name or the
  // author's own recipe (`custom:…`); null takes it off.
  avatarFrame: z
    .union([z.enum(AVATAR_FRAMES), z.string().regex(CUSTOM_FRAME_PATTERN)], {
      errorMap: () => ({ message: "That frame is not one this site can draw." }),
    })
    .nullable()
    .optional(),
  // "Talk to me" link on the public profile — a Delta Chat invite, a
  // Matrix room, an inbox, whatever the author already uses. Empty string
  // clears it. The platform hosts no messaging of its own.
  chatUrl: z.union([httpUrl(), z.literal("")]).optional(),
  coverUrl: httpUrl().optional(),
  links: z.array(z.object({ label: z.string().min(1).max(40), url: httpUrl() })).max(10).optional(),
  showDonations: z.boolean().optional(),
  showPurchaseCounts: z.boolean().optional(),
  showSubscriberCount: z.boolean().optional(),
  // Keep this author's page and posts out of search engines (noindex)…
  hideFromSearch: z.boolean().optional(),
  // …and, apart, out of fediverse search and suggestions. Federated: it
  // changes the actor (indexable, discoverable).
  hideFromFediverseSearch: z.boolean().optional(),
  // Free text (e.g. "PayPal: me@example.com", "IBAN: ..."). Empty string
  // clears it, which disables the manual checkout method for this creator.
  manualPaymentInstructions: z.string().max(1000).optional(),
  // Distinct welcome messages sent to a fan when each event completes.
  // Empty string clears it, falling back to a generic default.
  welcomeMessageNewSubscriber: z.string().max(1000).optional(),
  welcomeMessageRenewal: z.string().max(1000).optional(),
  welcomeMessageDonor: z.string().max(1000).optional(),
  // About the author. Each is optional; an empty string clears it. The
  // birth date is checked to be a real day, not in the future, by the service.
  birthDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date as YYYY-MM-DD."), z.literal("")]).optional(),
  // Off: the page shows the day and the sign but neither the year nor the age.
  showBirthYear: z.boolean().optional(),
  city: z.string().trim().max(80).optional(),
  country: z.union([z.string().refine(isCountryCode, { message: "Choose a country from the list." }), z.literal("")]).optional(),
  // A Spotify widget on the author's page; empty string removes it.
  spotifyUrl: z
    .union([
      z.string().refine((value) => parseSpotifyUrl(value) !== null, {
        message: "Paste a link to a Spotify track, album, playlist, episode, show or artist.",
      }),
      z.literal(""),
    ])
    .optional(),
});

export type BecomeCreatorInput = z.infer<typeof becomeCreatorSchema>;
export type UpdateCreatorProfileInput = z.infer<typeof updateCreatorProfileSchema>;
