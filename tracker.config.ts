/**
 * Everything a deployment might want to change, in one place.
 *
 * Read at build time, so a change needs a rebuild — the tracked subject and the
 * contact details are baked into the pages, not fetched.
 */

export interface TrackerConfig {
  /**
   * What is being tracked. Shown in the header, used as the map marker's label,
   * and used to namespace this deployment's data in the browser.
   *
   * Changing it does NOT move the server-side timeline — that follows
   * TRACKER_ID in wrangler.jsonc.
   */
  subject: string;

  /**
   * The call and LINE buttons fixed to the bottom right of every tab.
   *
   * Off unless switched on. These publish a personal phone number to anyone who
   * opens the page, so they stay dark until someone actually wants to be
   * reached — and because the switch is read at build time, a build with it off
   * does not carry the number at all.
   */
  contacts: {
    /** Dialled by the phone button, in full international form. */
    phone: string | null;
    /** Shown and copied by the LINE button, for "add by phone number". */
    lineId: string | null;
  };

  /** Whether the draggable portrait sits in the footer. */
  portrait: boolean;

  /** Where the map opens before anyone's position is known. */
  mapFallbackCenter: { lat: number; lon: number };

  /**
   * The one colour the whole UI is built from. Everything else — the ground
   * the proximity screen burns into, the halo behind the dial, the page
   * background, the ink on light buttons — is a shade of this same hue, see
   * `src/components/track/palette.ts`. Any CSS colour works; hex is easiest.
   */
  primaryColor: string;
}

/** Accepts the shapes a shell or a build UI is likely to hand over. */
const enabled = (value: string | undefined) =>
  value === "1" || value?.toLowerCase() === "true";

/*
 * Contacts live in the environment rather than in this file, so a public repo
 * never carries somebody's phone number. See .env.example.
 */
const showContacts = enabled(import.meta.env.PUBLIC_CONTACTS);

export const config: TrackerConfig = {
  subject: "bundit",

  contacts: {
    phone: showContacts ? (import.meta.env.PUBLIC_CONTACT_PHONE ?? null) : null,
    lineId: showContacts ? (import.meta.env.PUBLIC_CONTACT_LINE ?? null) : null,
  },

  portrait: true,

  // Bangkok.
  mapFallbackCenter: { lat: 13.7563, lon: 100.5018 },

  // The brand indigo this project shipped with.
  primaryColor: "#7f7cff",
};

/** Storage keys are namespaced per subject so two trackers don't share likes. */
export const storagePrefix = config.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-");
